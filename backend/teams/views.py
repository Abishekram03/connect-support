from datetime import timedelta

from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import strip_tags
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models as django_models
from rest_framework import status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Membership, Team, TeamMembership, Invitation
from .serializers import (
    MembershipSerializer,
    InvitationSerializer,
    InvitationCreateSerializer,
    TeamSerializer,
    TeamDetailSerializer,
    TeamCreateSerializer,
    TeamUpdateSerializer,
    TeamMembershipSerializer,
    AddMembersSerializer,
    UserMinimalSerializer,
    OrgSerializer,
)

User = get_user_model()


def get_org(request):
    if hasattr(request.user, "organization") and request.user.organization:
        return request.user.organization
    membership = Membership.objects.filter(user=request.user, status="active").first()
    if membership:
        return membership.organization
    return None


def check_seat_limit(org):
    plan_seats = {"free": 3, "starter": 15, "pro": 50, "enterprise": 9999}
    max_seats = plan_seats.get(org.plan, 3)
    current_count = Membership.objects.filter(organization=org, status__in=["active", "invited"]).count()
    return current_count < max_seats, max_seats


def require_admin(request, org):
    return Membership.objects.filter(user=request.user, organization=org, role__in=["owner", "admin"]).first()


# ─── Members ────────────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def list_members(request):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    memberships = Membership.objects.filter(organization=org).select_related("user", "invited_by")

    # Annotate open conversation counts per member
    from conversations.models import Conversation
    from django.db.models import Count
    open_counts = {
        str(uid): count
        for uid, count in (
            Conversation.objects.filter(
                organization=org, status__in=["open", "pending"]
            )
            .exclude(assignee_id=None)
            .values("assignee_id")
            .annotate(count=Count("id"))
            .values_list("assignee_id", "count")
        )
    }
    total_counts = {
        str(uid): count
        for uid, count in (
            Conversation.objects.filter(organization=org)
            .exclude(assignee_id=None)
            .values("assignee_id")
            .annotate(count=Count("id"))
            .values_list("assignee_id", "count")
        )
    }

    serializer = MembershipSerializer(memberships, many=True)
    data = serializer.data
    for m in data:
        uid = m["user"]["id"]
        m["open_conversations"] = open_counts.get(uid, 0)
        m["total_conversations"] = total_counts.get(uid, 0)
    return Response(data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def invite_member(request):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can invite members"}, status=status.HTTP_403_FORBIDDEN)

    can_invite, max_seats = check_seat_limit(org)
    if not can_invite:
        return Response(
            {"detail": f"Seat limit reached ({max_seats}). Upgrade your plan to invite more members."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = InvitationCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]
    role = serializer.validated_data["role"]

    if Membership.objects.filter(organization=org, user__email=email, status="active").exists():
        return Response({"detail": "User is already a member"}, status=status.HTTP_400_BAD_REQUEST)

    existing_invite = Invitation.objects.filter(
        organization=org, email=email, status="pending", expires_at__gt=timezone.now()
    ).first()
    if existing_invite:
        return Response({"detail": "Invitation already pending"}, status=status.HTTP_400_BAD_REQUEST)

    invitation = Invitation.objects.create(
        organization=org,
        email=email,
        role=role,
        invited_by=request.user,
        expires_at=timezone.now() + timedelta(days=7),
    )

    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            "username": email,
            "first_name": "",
            "is_active": False,
            "organization": org,
            "role": role,
            "status": "invited",
        },
    )

    Membership.objects.get_or_create(
        user=user,
        organization=org,
        defaults={"role": role, "status": "invited", "invited_by": request.user},
    )

    invite_url = f"{settings.FRONTEND_URL or 'http://localhost:3000'}/invite?token={invitation.token}"

    subject = f"{request.user.first_name or request.user.email} invited you to {org.name} on Connect"
    html_message = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="margin-bottom: 24px;">
            <div style="display: inline-block; background: #1a1a1a; color: white; padding: 6px 12px; border-radius: 8px; font-weight: bold; font-size: 14px;">C</div>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">You're invited to join {org.name}</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 24px;">
            <strong>{request.user.first_name or request.user.email}</strong> has invited you to collaborate on <strong>{org.name}</strong> as an <strong>{role}</strong>.
        </p>
        <a href="{invite_url}" style="display: inline-block; background: #1a1a1a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px;">Accept Invitation</a>
        <p style="font-size: 12px; color: #999; margin-top: 32px;">
            This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
        </p>
    </div>
    """

    try:
        send_mail(
            subject=subject,
            message=strip_tags(html_message),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            html_message=html_message,
            fail_silently=True,
        )
    except Exception:
        pass

    return Response(InvitationSerializer(invitation).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def remove_member(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can remove members"}, status=status.HTTP_403_FORBIDDEN)

    try:
        target = Membership.objects.get(pk=pk, organization=org)
    except Membership.DoesNotExist:
        return Response({"detail": "Member not found"}, status=status.HTTP_404_NOT_FOUND)

    if target.user == request.user:
        return Response({"detail": "Cannot remove yourself"}, status=status.HTTP_400_BAD_REQUEST)

    if target.role == "owner":
        return Response({"detail": "Cannot remove the owner"}, status=status.HTTP_400_BAD_REQUEST)

    caller_membership = Membership.objects.filter(
        user=request.user, organization=org, role__in=["owner", "admin"]
    ).first()

    if caller_membership.role == "admin" and target.role == "admin":
        return Response({"detail": "Admins cannot remove other admins"}, status=status.HTTP_403_FORBIDDEN)

    target.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["PATCH"])
@permission_classes([permissions.IsAuthenticated])
def update_member_role(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can update roles"}, status=status.HTTP_403_FORBIDDEN)

    try:
        target = Membership.objects.get(pk=pk, organization=org)
    except Membership.DoesNotExist:
        return Response({"detail": "Member not found"}, status=status.HTTP_404_NOT_FOUND)

    if target.role == "owner":
        return Response({"detail": "Cannot change the owner's role"}, status=status.HTTP_400_BAD_REQUEST)

    caller_membership = Membership.objects.filter(
        user=request.user, organization=org, role__in=["owner", "admin"]
    ).first()

    if caller_membership.role == "admin" and target.role == "admin":
        return Response({"detail": "Admins cannot change other admin roles"}, status=status.HTTP_403_FORBIDDEN)

    new_role = request.data.get("role")
    if new_role not in ["admin", "agent"]:
        return Response({"detail": "Invalid role"}, status=status.HTTP_400_BAD_REQUEST)

    target.role = new_role
    target.save(update_fields=["role"])
    return Response(MembershipSerializer(target).data)


# ─── Invitations ────────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def list_invitations(request):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    invitations = Invitation.objects.filter(organization=org, status="pending").select_related("invited_by")
    serializer = InvitationSerializer(invitations, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def resend_invitation(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        invitation = Invitation.objects.get(pk=pk, organization=org, status="pending")
    except Invitation.DoesNotExist:
        return Response({"detail": "Invitation not found"}, status=status.HTTP_404_NOT_FOUND)

    invitation.expires_at = timezone.now() + timedelta(days=7)
    invitation.save(update_fields=["expires_at"])

    invite_url = f"{settings.FRONTEND_URL or 'http://localhost:3000'}/invite?token={invitation.token}"

    subject = f"{request.user.first_name or request.user.email} invited you to {org.name} on Connect"
    html_message = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="margin-bottom: 24px;">
            <div style="display: inline-block; background: #1a1a1a; color: white; padding: 6px 12px; border-radius: 8px; font-weight: bold; font-size: 14px;">C</div>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">You're invited to join {org.name}</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 24px;">
            <strong>{request.user.first_name or request.user.email}</strong> has invited you to collaborate on <strong>{org.name}</strong> as an <strong>{invitation.role}</strong>.
        </p>
        <a href="{invite_url}" style="display: inline-block; background: #1a1a1a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px;">Accept Invitation</a>
        <p style="font-size: 12px; color: #999; margin-top: 32px;">
            This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
        </p>
    </div>
    """

    try:
        send_mail(
            subject=subject,
            message=strip_tags(html_message),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invitation.email],
            html_message=html_message,
            fail_silently=True,
        )
    except Exception:
        pass

    return Response(InvitationSerializer(invitation).data)


@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def cancel_invitation(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        invitation = Invitation.objects.get(pk=pk, organization=org, status="pending")
    except Invitation.DoesNotExist:
        return Response({"detail": "Invitation not found"}, status=status.HTTP_404_NOT_FOUND)

    invitation.status = "expired"
    invitation.save(update_fields=["status"])

    Membership.objects.filter(
        organization=org, user__email=invitation.email, status="invited"
    ).delete()

    return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Teams ──────────────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def list_teams(request):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    teams = Team.objects.filter(organization=org)
    serializer = TeamSerializer(teams, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def create_team(request):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can create teams"}, status=status.HTTP_403_FORBIDDEN)

    plan_teams = {"free": 1, "starter": 5, "pro": 20, "enterprise": 9999}
    max_teams = plan_teams.get(org.plan, 1)
    current_count = Team.objects.filter(organization=org).count()
    if current_count >= max_teams:
        return Response(
            {"detail": f"Team limit reached ({max_teams}). Upgrade your plan to create more teams."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = TeamCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    team = Team.objects.create(
        organization=org,
        name=serializer.validated_data["name"],
        description=serializer.validated_data.get("description", ""),
    )

    return Response(TeamDetailSerializer(team).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def get_team(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    data = TeamDetailSerializer(team).data

    # Add open conversation counts per member
    from conversations.models import Conversation
    from django.db.models import Count
    team_user_ids = TeamMembership.objects.filter(team=team).values_list("user_id", flat=True)
    open_counts = {
        str(uid): count
        for uid, count in (
            Conversation.objects.filter(
                organization=org, assignee_id__in=team_user_ids, status__in=["open", "pending"]
            )
            .values("assignee_id")
            .annotate(count=Count("id"))
            .values_list("assignee_id", "count")
        )
    }
    total_counts = {
        str(uid): count
        for uid, count in (
            Conversation.objects.filter(
                organization=org, assignee_id__in=team_user_ids
            )
            .values("assignee_id")
            .annotate(count=Count("id"))
            .values_list("assignee_id", "count")
        )
    }
    for m in data.get("members", []):
        uid = m["user"]["id"]
        m["open_conversations"] = open_counts.get(uid, 0)
        m["total_conversations"] = total_counts.get(uid, 0)

    return Response(data)


@api_view(["PATCH"])
@permission_classes([permissions.IsAuthenticated])
def update_team(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can update teams"}, status=status.HTTP_403_FORBIDDEN)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    serializer = TeamUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)

    if "name" in serializer.validated_data:
        team.name = serializer.validated_data["name"]
    if "description" in serializer.validated_data:
        team.description = serializer.validated_data["description"]
    team.save()

    return Response(TeamDetailSerializer(team).data)


@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def delete_team(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can delete teams"}, status=status.HTTP_403_FORBIDDEN)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    team.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Team Members ───────────────────────────────────────────────────────────


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def add_team_members(request, pk):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can manage team members"}, status=status.HTTP_403_FORBIDDEN)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    serializer = AddMembersSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user_ids = serializer.validated_data["user_ids"]
    role = request.data.get("role", "member")
    if role not in ["admin", "member"]:
        role = "member"

    org_member_ids = list(
        Membership.objects.filter(organization=org, status="active").values_list("user_id", flat=True)
    )

    added = 0
    for user_id in user_ids:
        if user_id not in org_member_ids:
            continue
        _, created = TeamMembership.objects.get_or_create(team=team, user_id=user_id, defaults={"role": role})
        if created:
            added += 1

    return Response({"detail": f"Added {added} member(s) to {team.name}"}, status=status.HTTP_200_OK)


@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def remove_team_member(request, pk, user_id):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can manage team members"}, status=status.HTTP_403_FORBIDDEN)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        tm = TeamMembership.objects.get(team=team, user_id=user_id)
        tm.delete()
    except TeamMembership.DoesNotExist:
        return Response({"detail": "Member not in team"}, status=status.HTTP_404_NOT_FOUND)

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["PATCH"])
@permission_classes([permissions.IsAuthenticated])
def update_team_member_role(request, pk, user_id):
    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if not require_admin(request, org):
        return Response({"detail": "Only admins can manage team members"}, status=status.HTTP_403_FORBIDDEN)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    new_role = request.data.get("role")
    if new_role not in ["admin", "member"]:
        return Response({"detail": "Invalid role. Must be 'admin' or 'member'"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        tm = TeamMembership.objects.get(team=team, user_id=user_id)
    except TeamMembership.DoesNotExist:
        return Response({"detail": "Member not in team"}, status=status.HTTP_404_NOT_FOUND)

    tm.role = new_role
    tm.save(update_fields=["role"])

    return Response({
        "user": {
            "id": str(tm.user.id),
            "email": tm.user.email,
            "name": tm.user.first_name or tm.user.email,
        },
        "role": tm.role,
    })


# ─── Team Analytics ─────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def team_analytics(request, pk):
    from conversations.models import Conversation, Message
    from django.db.models import Count, Q

    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        team = Team.objects.get(pk=pk, organization=org)
    except Team.DoesNotExist:
        return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

    team_user_ids = TeamMembership.objects.filter(team=team).values_list("user_id", flat=True)

    conversations = Conversation.objects.filter(
        organization=org, assignee_id__in=team_user_ids
    )

    status_counts = conversations.aggregate(
        total=Count("id"),
        open=Count("id", filter=Q(status="open")),
        pending=Count("id", filter=Q(status="pending")),
        closed=Count("id", filter=Q(status="closed")),
    )

    total_messages = Message.objects.filter(
        conversation__organization=org,
        conversation__assignee_id__in=team_user_ids,
        is_from_customer=False,
    ).count()

    member_stats = []
    for tm in TeamMembership.objects.filter(team=team).select_related("user"):
        member_convs = Conversation.objects.filter(
            organization=org, assignee=tm.user
        )
        member_msgs = Message.objects.filter(
            conversation__organization=org,
            conversation__assignee=tm.user,
            is_from_customer=False,
        ).count()
        member_stats.append({
            "user": {
                "id": str(tm.user.id),
                "email": tm.user.email,
                "name": tm.user.first_name or tm.user.email,
            },
            "role": tm.role,
            "conversations_handled": member_convs.count(),
            "open": member_convs.filter(status="open").count(),
            "closed": member_convs.filter(status="closed").count(),
            "messages_sent": member_msgs,
        })

    recent_convs = conversations.select_related("assignee").order_by("-last_message_at")[:5]
    recent = []
    for c in recent_convs:
        recent.append({
            "id": str(c.id),
            "customer_name": c.customer_name or "Unknown",
            "subject": c.subject or "No subject",
            "status": c.status,
            "assignee": c.assignee.email if c.assignee else None,
            "last_message_at": c.last_message_at.isoformat(),
        })

    return Response({
        "team": {
            "id": str(team.id),
            "name": team.name,
            "description": team.description,
        },
        "conversations": status_counts,
        "total_messages": total_messages,
        "members": member_stats,
        "recent_conversations": recent,
    })


# ─── Auto-Assignment ────────────────────────────────────────────────────────


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def auto_assign(request, pk):
    from conversations.models import Conversation

    org = get_org(request)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        conversation = Conversation.objects.get(pk=pk, organization=org)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    team_id = request.data.get("team_id")

    if team_id:
        try:
            team = Team.objects.get(pk=team_id, organization=org)
        except Team.DoesNotExist:
            return Response({"detail": "Team not found"}, status=status.HTTP_404_NOT_FOUND)

        team_member_ids = TeamMembership.objects.filter(team=team).values_list("user_id", flat=True)
        agents = User.objects.filter(
            id__in=team_member_ids,
            memberships__organization=org,
            memberships__status="active",
        )
    else:
        agents = User.objects.filter(
            memberships__organization=org,
            memberships__status="active",
            memberships__role__in=["admin", "agent"],
        )

    from django.db.models import Count

    agents_with_counts = agents.annotate(
        open_conversations=Count(
            "assigned_conversations",
            filter=django_models.Q(assigned_conversations__status="open"),
        )
    ).order_by("open_conversations")

    if not agents_with_counts.exists():
        return Response({"detail": "No available agents"}, status=status.HTTP_400_BAD_REQUEST)

    selected = agents_with_counts.first()
    conversation.assignee = selected
    conversation.save(update_fields=["assignee"])

    return Response({
        "detail": f"Assigned to {selected.email}",
        "assignee": UserMinimalSerializer(selected).data,
    })


# ─── User Orgs (for org switcher) ─────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def user_orgs(request):
    memberships = Membership.objects.filter(
        user=request.user, status__in=["active", "invited"]
    ).select_related("organization")

    orgs = []
    for m in memberships:
        orgs.append({
            "id": str(m.organization.id),
            "name": m.organization.name,
            "slug": m.organization.slug,
            "plan": m.organization.plan,
            "role": m.role,
            "is_primary": m.organization.id == request.user.organization_id,
        })

    return Response(orgs)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def switch_org(request):
    org_id = request.data.get("org_id")
    if not org_id:
        return Response({"detail": "org_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        membership = Membership.objects.select_related("organization").get(
            user=request.user, organization_id=org_id, status="active"
        )
    except Membership.DoesNotExist:
        return Response({"detail": "Not a member of this organization"}, status=status.HTTP_403_FORBIDDEN)

    request.user.organization = membership.organization
    request.user.role = membership.role
    request.user.save(update_fields=["organization", "role"])

    return Response({
        "id": str(membership.organization.id),
        "name": membership.organization.name,
        "slug": membership.organization.slug,
        "plan": membership.organization.plan,
        "timezone": membership.organization.timezone,
        "created_at": membership.organization.created_at.isoformat(),
    })


# ─── Accept Invitation (public) ────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def get_invitation_by_token(request):
    token = request.query_params.get("token")
    if not token:
        return Response({"detail": "Token is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        invitation = Invitation.objects.select_related("organization", "invited_by").get(
            token=token, status="pending", expires_at__gt=timezone.now()
        )
    except Invitation.DoesNotExist:
        return Response({"detail": "Invalid or expired invitation"}, status=status.HTTP_404_NOT_FOUND)

    user_exists = User.objects.filter(email=invitation.email).exists()
    user_is_active = User.objects.filter(email=invitation.email, is_active=True).exists()

    return Response({
        "email": invitation.email,
        "role": invitation.role,
        "organization_name": invitation.organization.name,
        "invited_by": invitation.invited_by.first_name or invitation.invited_by.email if invitation.invited_by else None,
        "user_exists": user_exists,
        "user_is_active": user_is_active,
    })


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def accept_invitation(request):
    token = request.data.get("token")
    name = request.data.get("name", "")
    password = request.data.get("password", "")

    if not token:
        return Response({"detail": "Token is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        invitation = Invitation.objects.select_related("organization").get(
            token=token, status="pending", expires_at__gt=timezone.now()
        )
    except Invitation.DoesNotExist:
        return Response({"detail": "Invalid or expired invitation"}, status=status.HTTP_404_NOT_FOUND)

    user, created = User.objects.get_or_create(
        email=invitation.email,
        defaults={
            "username": invitation.email,
            "first_name": name,
            "is_active": True,
            "organization": invitation.organization,
            "role": invitation.role,
            "status": "active",
        },
    )

    if not created:
        if not user.is_active and password:
            user.set_password(password)
            user.is_active = True
            user.first_name = name or user.first_name
            user.status = "active"
            user.save(update_fields=["password", "is_active", "first_name", "status"])

    membership, mem_created = Membership.objects.get_or_create(
        user=user,
        organization=invitation.organization,
        defaults={"role": invitation.role, "status": "active", "invited_by": invitation.invited_by},
    )
    if not mem_created:
        membership.status = "active"
        membership.role = invitation.role
        membership.save(update_fields=["status", "role"])

    invitation.status = "accepted"
    invitation.save(update_fields=["status"])

    refresh = RefreshToken.for_user(user)
    return Response({
        "user": {
            "id": str(user.id),
            "email": user.email,
            "name": user.first_name,
            "role": user.role,
            "status": user.status,
            "organization": {
                "id": str(invitation.organization.id),
                "name": invitation.organization.name,
                "slug": invitation.organization.slug,
                "timezone": invitation.organization.timezone,
                "plan": invitation.organization.plan,
                "created_at": invitation.organization.created_at.isoformat(),
            },
            "date_joined": user.date_joined.isoformat(),
        },
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    })
