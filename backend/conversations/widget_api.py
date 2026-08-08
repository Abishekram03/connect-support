import uuid
import os
from django.http import HttpResponse
from django.utils import timezone
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from accounts.models import Organization
from workspace.models import WidgetConfig, Branding
from .models import Conversation, Message
from .serializers import MessageSerializer, ConversationListSerializer


class WidgetConfigThrottle(AnonRateThrottle):
    rate = "120/minute"


class WidgetConversationThrottle(AnonRateThrottle):
    rate = "120/minute"


class WidgetMessageThrottle(AnonRateThrottle):
    rate = "120/minute"


class WidgetAutoReplyThrottle(AnonRateThrottle):
    """Per-IP throttle for AI auto-reply to prevent credit burn."""
    rate = "60/minute"


def _check_session_conversation_limit(org_id, session_token):
    """Prevent a session from creating more than 1 conversation per 24h."""
    return True  # Temporarily disabled for testing


def _check_org_message_rate(org_id):
    """Per-org message rate to prevent spam."""
    cache_key = f"widget_msg_rate:{org_id}"
    count = cache.get(cache_key, 0)
    if count >= 100:  # 100 messages/min per org
        return False
    cache.set(cache_key, count + 1, timeout=60)
    return True


def _check_org_ai_rate(org_id):
    """Per-org AI auto-reply rate to protect credits (30/min)."""
    cache_key = f"widget_ai_rate:{org_id}"
    count = cache.get(cache_key, 0)
    if count >= 30:
        return False
    cache.set(cache_key, count + 1, timeout=60)
    return True


def _validate_session_token(conversation, session_token):
    """Verify the session_token matches the conversation."""
    if not session_token:
        return False
    return conversation.session_token == session_token


MAX_ASSIGNED_CONVERSATIONS = 5


def _auto_assign_new_conversation(conversation):
    """Auto-assign a new conversation to the least busy agent."""
    try:
        from teams.models import TeamMembership
        from django.contrib.auth import get_user_model
        from django.db.models import Count

        User = get_user_model()
        org = conversation.organization

        agent_ids = TeamMembership.objects.filter(
            team__organization=org,
            role__in=["admin", "member"],
        ).values_list("user_id", flat=True).distinct()

        org_admin_ids = User.objects.filter(
            organization=org,
            role__in=["admin", "owner"],
        ).values_list("id", flat=True)
        all_agent_ids = list(set(list(agent_ids) + list(org_admin_ids)))

        # Only consider agents who are online
        all_agent_ids = list(
            User.objects.filter(id__in=all_agent_ids, is_online=True).values_list("id", flat=True)
        )

        if not all_agent_ids:
            return

        agent_counts = (
            Conversation.objects.filter(
                assignee_id__in=all_agent_ids,
                status__in=["open", "pending"],
            )
            .values("assignee_id")
            .annotate(count=Count("id"))
            .order_by("count")
        )
        # Agents who still have capacity (under MAX_ASSIGNED_CONVERSATIONS open conversations)
        capped_ids = {
            c["assignee_id"] for c in agent_counts if c["count"] >= MAX_ASSIGNED_CONVERSATIONS
        }
        eligible_ids = [aid for aid in all_agent_ids if aid not in capped_ids]
        if not eligible_ids:
            return  # Everyone is at capacity — leave it for manual dispatch

        assigned_ids = {c["assignee_id"] for c in agent_counts}
        for agent_id in eligible_ids:
            if agent_id not in assigned_ids:
                conversation.assignee_id = agent_id
                break
        else:
            if agent_counts:
                conversation.assignee_id = agent_counts[0]["assignee_id"]

        conversation.assigned_at = timezone.now()
        update_fields = ["assignee", "assigned_at"]
        if conversation.assignee_id and not conversation.team_id:
            # Prefer the configured auto-assign team; fall back to the agent's first team
            try:
                from ai_service.models import AIConfig
                ai_config = AIConfig.objects.filter(organization=org).first()
                team_id = ai_config.auto_assign_team_id if ai_config else None
                if team_id:
                    conversation.team_id = team_id
                else:
                    team_member = TeamMembership.objects.filter(
                        user_id=conversation.assignee_id, team__organization=org
                    ).first()
                    if team_member:
                        conversation.team_id = team_member.team_id
                update_fields.append("team")
            except Exception:
                pass
        conversation.save(update_fields=update_fields)

        # Notify the assigned agent
        if conversation.assignee_id:
            try:
                from notifications.views import create_notification
                assigned_user = User.objects.get(pk=conversation.assignee_id)
                create_notification(
                    org=conversation.organization,
                    notification_type="new_conversation",
                    title=f"New conversation assigned to you: {conversation.customer_name or f'Visitor #{conversation.ticket_id}'}",
                    body=f"You have been assigned a new conversation — {conversation.customer_name or 'a visitor'} is waiting",
                    conversation=conversation,
                    recipient=assigned_user,
                )
            except Exception:
                pass

    except Exception:
        pass


def _auto_assign_escalation(conversation):
    """Auto-assign escalated conversation to an available agent."""
    try:
        from ai_service.models import AIConfig
        from teams.models import Team, TeamMembership
        from django.contrib.auth import get_user_model
        from django.db.models import Count

        User = get_user_model()
        ai_config = AIConfig.objects.filter(organization=conversation.organization).first()

        if not ai_config or not ai_config.auto_assign_on_escalation:
            return

        # Increase priority if configured
        if ai_config.escalation_increase_priority:
            if conversation.priority in ("low", "normal"):
                conversation.priority = "high"
                conversation.save(update_fields=["priority"])

        # Determine target team
        target_team_id = ai_config.auto_assign_team_id
        if target_team_id:
            try:
                team = Team.objects.get(pk=target_team_id, organization=conversation.organization)
                conversation.team = team
            except Team.DoesNotExist:
                pass

        # Get available agents
        agent_ids = TeamMembership.objects.filter(
            team__organization=conversation.organization,
            role__in=["admin", "member"],
        ).values_list("user_id", flat=True).distinct()

        # Also include org admins/owners
        org_admin_ids = User.objects.filter(
            organization=conversation.organization,
            role__in=["admin", "owner"],
        ).values_list("id", flat=True)
        all_agent_ids = list(set(list(agent_ids) + list(org_admin_ids)))

        # Only consider agents who are online
        all_agent_ids = list(
            User.objects.filter(id__in=all_agent_ids, is_online=True).values_list("id", flat=True)
        )

        if not all_agent_ids:
            return

        # Only consider agents with remaining capacity
        open_counts = (
            Conversation.objects.filter(
                assignee_id__in=all_agent_ids,
                status__in=["open", "pending"],
            )
            .values("assignee_id")
            .annotate(count=Count("id"))
        )
        count_by_agent = {c["assignee_id"]: c["count"] for c in open_counts}
        eligible_ids = [
            aid for aid in all_agent_ids if count_by_agent.get(aid, 0) < MAX_ASSIGNED_CONVERSATIONS
        ]
        if not eligible_ids:
            return  # Everyone is at capacity — do not overload an agent

        if ai_config.auto_assign_routing == "least_busy":
            # Find agent with fewest active conversations
            agent_counts = (
                Conversation.objects.filter(
                    assignee_id__in=eligible_ids,
                    status__in=["open", "pending"],
                )
                .values("assignee_id")
                .annotate(count=Count("id"))
                .order_by("count")
            )
            assigned_ids = {c["assignee_id"] for c in agent_counts}
            for agent_id in eligible_ids:
                if agent_id not in assigned_ids:
                    conversation.assignee_id = agent_id
                    break
            else:
                if agent_counts:
                    conversation.assignee_id = agent_counts[0]["assignee_id"]
        else:
            # Round-robin: pick the eligible agent who was assigned least recently
            from django.db.models import Max
            last_assigned = (
                Conversation.objects.filter(
                    assignee_id__in=eligible_ids,
                )
                .values("assignee_id")
                .annotate(last_assigned=Max("assigned_at"))
                .order_by("last_assigned")
            )
            assigned_set = {c["assignee_id"] for c in last_assigned}
            for agent_id in eligible_ids:
                if agent_id not in assigned_set:
                    conversation.assignee_id = agent_id
                    break
            else:
                if last_assigned:
                    conversation.assignee_id = last_assigned[0]["assignee_id"]

        conversation.assigned_at = timezone.now()
        update_fields = ["assignee", "team", "assigned_at", "priority"]
        if not conversation.team_id:
            # Prefer the configured auto-assign team; fall back to the agent's first team
            try:
                team_id = target_team_id
                if not team_id:
                    team_member = TeamMembership.objects.filter(
                        user_id=conversation.assignee_id, team__organization=conversation.organization
                    ).first()
                    if team_member:
                        team_id = team_member.team_id
                if team_id:
                    conversation.team_id = team_id
            except Exception:
                pass
        conversation.save(update_fields=update_fields)

        # Notify the assigned agent specifically
        if conversation.assignee_id:
            try:
                from notifications.views import create_notification
                assigned_user = User.objects.get(pk=conversation.assignee_id)
                create_notification(
                    org=conversation.organization,
                    notification_type="escalation",
                    title=f"Escalation assigned to you: {conversation.customer_name or f'Visitor #{conversation.ticket_id}'}",
                    body=f"You have been assigned a new escalated conversation",
                    conversation=conversation,
                    recipient=assigned_user,
                )
            except Exception:
                pass

    except Exception:
        pass  # Don't break widget flow if auto-assign fails


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([WidgetConfigThrottle])
def widget_config(request):
    org_id = request.query_params.get("organization_id")
    if not org_id:
        return Response({"error": "organization_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        org = Organization.objects.get(pk=org_id)
    except (Organization.DoesNotExist, uuid.UUIDException):
        return Response({"error": "Organization not found"}, status=status.HTTP_404_NOT_FOUND)

    wc, _ = WidgetConfig.objects.get_or_create(organization=org)
    br, _ = Branding.objects.get_or_create(organization=org)

    return Response({
        "organizationId": str(org.id),
        "organizationName": org.name,
        "primaryColor": br.primary_color,
        "companyName": br.company_name,
        "logoUrl": request.build_absolute_uri(br.effective_logo_url) if br.logo else br.effective_logo_url,
        "position": wc.position,
        "borderRadius": wc.border_radius,
        "showBranding": wc.show_branding,
        "autoGreet": wc.auto_greet,
        "autoGreetDelay": wc.auto_greet_delay,
        "collectEmail": wc.collect_email,
        "aiReplyEnabled": getattr(org, 'ai_config', None) and org.ai_config.auto_reply_enabled,
    })


@api_view(["GET", "POST", "PATCH"])
@permission_classes([AllowAny])
@throttle_classes([WidgetConversationThrottle])
def widget_conversations(request):
    if request.method == "GET":
        email = request.query_params.get("email", "").strip().lower()
        org_id = request.query_params.get("organization_id", "").strip()
        session_token = request.query_params.get("session_token", "").strip()
        if not email and not org_id and not session_token:
            return Response({"error": "email, organization_id, or session_token is required"}, status=status.HTTP_400_BAD_REQUEST)

        if org_id:
            try:
                uuid.UUID(org_id)
            except ValueError:
                return Response({"error": "Invalid organization_id"}, status=status.HTTP_400_BAD_REQUEST)

        from django.db.models import Q
        q = Q()
        if org_id:
            q &= Q(organization_id=org_id)
        if email and session_token:
            q &= (Q(customer_email__iexact=email) | Q(session_token=session_token))
        elif email:
            q &= Q(customer_email__iexact=email)
        elif session_token:
            q &= Q(session_token=session_token)

        qs = Conversation.objects.filter(q).order_by("-last_message_at")[:20]
        return Response(ConversationListSerializer(qs, many=True).data)

    # PATCH — update conversation customer info (name, email)
    if request.method == "PATCH":
        conversation_id = request.data.get("conversation_id")
        session_token = request.data.get("session_token", "").strip()
        if not conversation_id:
            return Response({"error": "conversation_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not session_token:
            return Response({"error": "session_token is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            conversation = Conversation.objects.get(pk=conversation_id)
        except (Conversation.DoesNotExist, uuid.UUIDException):
            return Response({"error": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

        # Verify session token matches
        if conversation.session_token != session_token:
            return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)

        # Update fields
        customer_name = request.data.get("customer_name")
        customer_email = request.data.get("customer_email")
        updated_fields = []

        if customer_name is not None:
            conversation.customer_name = customer_name.strip()[:200]
            updated_fields.append("customer_name")
        if customer_email is not None:
            conversation.customer_email = customer_email.strip().lower()[:254]
            updated_fields.append("customer_email")

        if updated_fields:
            conversation.save(update_fields=updated_fields)

        return Response({
            "id": str(conversation.id),
            "customer_name": conversation.customer_name,
            "customer_email": conversation.customer_email,
        })

    # POST — create new conversation
    org_id = request.data.get("organization_id")
    session_token = request.data.get("session_token", "").strip()
    if not org_id:
        return Response({"error": "organization_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        org = Organization.objects.get(pk=org_id)
    except (Organization.DoesNotExist, uuid.UUIDException):
        return Response({"error": "Organization not found"}, status=status.HTTP_404_NOT_FOUND)

    # Rate limit: 1 conversation per session per 24h
    if not _check_session_conversation_limit(org_id, session_token):
        return Response(
            {"error": "You can only start one conversation every 24 hours. Please continue your existing conversation."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Check for existing open conversation for this session
    if session_token:
        existing = Conversation.objects.filter(
            organization=org, session_token=session_token, status__in=["open", "pending"]
        ).first()
        if existing:
            return Response({
                "id": str(existing.id),
                "ticket_id": existing.ticket_id,
                "created_at": existing.created_at.isoformat(),
                "existing": True,
            }, status=status.HTTP_200_OK)

    # Validate input lengths
    customer_name = request.data.get("customer_name", "").strip()[:200]
    customer_email = request.data.get("customer_email", "").strip().lower()[:254]
    subject = request.data.get("subject", "").strip()[:500]

    conversation = Conversation.objects.create(
        organization=org,
        status="open",
        channel="widget",
        customer_name=customer_name,
        customer_email=customer_email,
        session_token=session_token,
        subject=subject,
    )

    # Auto-assign new conversation to least busy agent
    try:
        _auto_assign_new_conversation(conversation)
    except Exception:
        pass

    # Compute SLA deadline based on priority
    try:
        conversation.sla_deadline = conversation.compute_sla_deadline()
        conversation.save(update_fields=["sla_deadline"])
    except Exception:
        pass

    # Create notification for new conversation
    try:
        from notifications.views import create_notification
        display_name = customer_name or customer_email or "Customer"
        create_notification(
            org=org,
            notification_type="new_conversation",
            title=f"New conversation from {display_name}",
            body=subject or "New support request",
            conversation=conversation,
        )
    except Exception:
        pass

    return Response({
        "id": str(conversation.id),
        "ticket_id": conversation.ticket_id,
        "created_at": conversation.created_at.isoformat(),
    }, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
@throttle_classes([WidgetMessageThrottle])
def conversation_messages(request, pk):
    try:
        conversation = Conversation.objects.get(pk=pk)
    except (Conversation.DoesNotExist, uuid.UUIDException):
        return Response({"error": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    # Verify caller owns this conversation via session_token
    session_token = request.data.get("session_token", "").strip() if request.method == "POST" else request.query_params.get("session_token", "").strip()
    email = request.query_params.get("email", "").strip().lower()

    if not session_token and not email and not request.user.is_authenticated:
        return Response({"error": "session_token or email required"}, status=status.HTTP_403_FORBIDDEN)

    if session_token:
        if not _validate_session_token(conversation, session_token):
            return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
    elif email:
        if conversation.customer_email.lower() != email:
            return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
    elif not request.user.is_authenticated:
        return Response({"error": "session_token or email required"}, status=status.HTTP_403_FORBIDDEN)

    # Org-level message rate limit
    org_id = str(conversation.organization_id)
    if not _check_org_message_rate(org_id):
        return Response(
            {"error": "Message rate limit exceeded. Please wait before sending more messages."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    if request.method == "GET":
        since = request.query_params.get("since")
        messages = conversation.messages.filter(type="reply").order_by("created_at")
        if since:
            messages = messages.filter(created_at__gt=since)
        serializer = MessageSerializer(messages, many=True)
        return Response(serializer.data)

    # POST
    body = request.data.get("body", "").strip()
    if not body:
        return Response({"error": "body is required"}, status=status.HTTP_400_BAD_REQUEST)
    body = body[:5000]

    # Detect language of customer message
    detected_lang = "en"
    try:
        from ai_service.translation import detect_language
        detected_lang = detect_language(body)
    except Exception:
        pass

    # Translate inbound customer message to English for the agent
    original_body = ""
    translated_body = body
    if detected_lang and detected_lang != "en":
        try:
            from ai_service.translation import translate_text
            translated = translate_text(body, detected_lang, "en")
            if translated and translated != body:
                original_body = body
                translated_body = translated
        except Exception:
            pass

    message = Message.objects.create(
        conversation=conversation,
        type="reply",
        body=translated_body,
        original_body=original_body,
        is_from_customer=True,
        detected_language=detected_lang,
    )

    conversation.last_message_at = timezone.now()
    conversation.save(update_fields=["last_message_at"])

    # Create notification for new customer message
    try:
        from notifications.views import create_notification
        customer_name = conversation.customer_name or conversation.customer_email or "Customer"
        create_notification(
            org=conversation.organization,
            notification_type="new_message",
            title=f"New message from {customer_name}",
            body=body[:200],
            conversation=conversation,
        )
    except Exception:
        pass

    # Check for AI auto-reply
    ai_reply_data = None
    try:
        from ai_service.models import AIConfig
        from ai_service.rag import get_provider, generate_reply

        ai_config = AIConfig.objects.filter(organization=conversation.organization).first()
        # A human is now engaged (agent already replied) or the AI already handed
        # the conversation to a human — never have the AI talk over them.
        if not ai_config or not ai_config.auto_reply_enabled:
            pass
        elif conversation.first_response_at or conversation.handoff_requested_at:
            pass
        else:
            # Per-org AI rate limit
            if not _check_org_ai_rate(org_id):
                ai_reply_data = {"escalate": True, "reason": "rate_limit_exceeded"}
                # Notify human agents
                try:
                    from notifications.views import create_notification
                    create_notification(
                        org=conversation.organization,
                        notification_type="escalation",
                        title=f"Escalation: {conversation.customer_name or conversation.customer_email or f'Visitor #{conversation.ticket_id}'}",
                        body="AI rate limit exceeded — needs human response",
                        conversation=conversation,
                    )
                except Exception:
                    pass
                # Auto-assign to agent if configured
                _auto_assign_escalation(conversation)
                # Mark handoff so the AI never replies again in this conversation
                conversation.handoff_requested_at = timezone.now()
                conversation.save(update_fields=["handoff_requested_at"])
            else:
                provider = get_provider(conversation.organization)

                # Get agent's preferred language (first admin/owner of the org)
                agent_language = "en"
                try:
                    from accounts.models import User
                    agent_user = User.objects.filter(
                        organization=conversation.organization,
                        role__in=["admin", "owner"]
                    ).first()
                    if agent_user and agent_user.language:
                        agent_language = agent_user.language
                except Exception:
                    pass

                history = list(
                    conversation.messages.filter(type="reply")
                    .order_by("created_at")
                    .values("body", "is_from_customer")
                )
                result = generate_reply(
                    conversation.organization, body, history, provider, ai_config,
                    agent_language=agent_language,
                )

                # Log this AI reply for analytics
                try:
                    from ai_service.models import AIReplyLog
                    AIReplyLog.objects.create(
                        conversation=conversation,
                        organization=conversation.organization,
                        model_used=getattr(provider, "model", "unknown"),
                        prompt_tokens=result.get("prompt_tokens", 0),
                        completion_tokens=result.get("completion_tokens", 0),
                        confidence=result.get("confidence", 0),
                        escalated=bool(result["escalate"]),
                        escalation_reason=result.get("escalation_reason", ""),
                        sources_used=result.get("sources", []),
                        response_text=result.get("content", "")[:5000],
                    )
                except Exception:
                    pass

                if not result["escalate"]:
                    ai_message = Message.objects.create(
                        conversation=conversation,
                        type="reply",
                        body=result["content"],
                        original_body=result.get("original_content", ""),
                        detected_language=result.get("detected_language", "en"),
                        sender=None,
                        is_from_customer=False,
                    )
                    conversation.last_message_at = timezone.now()
                    conversation.save(update_fields=["last_message_at"])
                    ai_reply_data = {
                        "id": str(ai_message.id),
                        "body": result["content"],
                        "original_body": result.get("original_content", ""),
                        "detected_language": result.get("detected_language", "en"),
                        "confidence": result["confidence"],
                    }
                else:
                    # Still send the AI reply but flag it as escalated
                    ai_message = Message.objects.create(
                        conversation=conversation,
                        type="reply",
                        body=result["content"],
                        original_body=result.get("original_content", ""),
                        detected_language=result.get("detected_language", "en"),
                        sender=None,
                        is_from_customer=False,
                    )
                    conversation.last_message_at = timezone.now()
                    conversation.save(update_fields=["last_message_at"])
                    ai_reply_data = {
                        "id": str(ai_message.id),
                        "body": result["content"],
                        "original_body": result.get("original_content", ""),
                        "detected_language": result.get("detected_language", "en"),
                        "confidence": result["confidence"],
                        "escalate": True,
                        "reason": result["escalation_reason"],
                    }

                    # Notify human agents about escalation
                    try:
                        from notifications.views import create_notification
                        reason_display = {
                            "angry_customer": "Angry customer detected",
                            "low_confidence": "AI low confidence",
                            "explicit_human_request": "Customer requested human agent",
                            "max_ai_turns_reached": "Max AI turns reached",
                            "rate_limit_exceeded": "AI rate limit exceeded",
                        }.get(result["escalation_reason"], "Escalated to human")
                        create_notification(
                            org=conversation.organization,
                            notification_type="escalation",
                            title=f"Escalation: {conversation.customer_name or conversation.customer_email or f'Visitor #{conversation.ticket_id}'}",
                            body=reason_display,
                            conversation=conversation,
                        )
                    except Exception:
                        pass

                    # Auto-assign to agent if configured
                    _auto_assign_escalation(conversation)
                    # Mark handoff so the AI never replies again in this conversation
                    conversation.handoff_requested_at = timezone.now()
                    conversation.save(update_fields=["handoff_requested_at"])

                    # Option B: all agents busy/at capacity — customer is queued
                    if not conversation.assignee_id:
                        queue_msg = (
                            "Thanks for waiting! All our agents are currently helping other customers, "
                            "so I've queued your conversation — we'll connect you with someone as soon "
                            "as one is free."
                        )
                        try:
                            from ai_service.translation import translate_text
                            customer_lang = result.get("detected_language") or "en"
                            if customer_lang != "en":
                                translated_q = translate_text(queue_msg, "en", customer_lang)
                                if translated_q and translated_q != queue_msg:
                                    queue_msg = translated_q
                        except Exception:
                            pass
                        if ai_message:
                            ai_message.body = queue_msg
                            ai_message.original_body = ""
                            ai_message.save(update_fields=["body", "original_body"])
                            if ai_reply_data:
                                ai_reply_data["body"] = queue_msg
                                ai_reply_data["original_body"] = ""
    except Exception:
        pass  # Don't break the widget flow if AI fails

    response_data = MessageSerializer(message).data
    if ai_reply_data:
        response_data["ai_reply"] = ai_reply_data

    return Response(response_data, status=status.HTTP_201_CREATED)


WIDGET_URL = os.getenv("NEXT_PUBLIC_WIDGET_URL", "http://localhost:3001")

EMBED_SCRIPT = f"""(function() {{
  if (window.__connect_loaded) return;
  window.__connect_loaded = true;

  var script = document.currentScript;
  var orgId = script?.getAttribute('data-org-id');
  if (!orgId) {{
    console.error('[Connect] Missing data-org-id attribute');
    return;
  }}

  var WIDGET_URL = '{WIDGET_URL}';
  var POSITION = (script?.getAttribute('data-position') || 'bottom-right').trim();
  var COLOR = script?.getAttribute('data-color') || '#2563eb';

  var isLeft = POSITION === 'bottom-left';
  var sideProp = isLeft ? 'left' : 'right';

  // Create launcher button
  var launcher = document.createElement('div');
  launcher.id = 'connect-widget-launcher';
  launcher.style.cssText = 'position:fixed;bottom:20px;' + sideProp + ':20px;z-index:10000;cursor:pointer;border-radius:50%;width:56px;height:56px;background:' + COLOR + ';display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(0,0,0,0.2);transition:transform 0.2s,opacity 0.2s;';
  launcher.setAttribute('role', 'button');
  launcher.setAttribute('aria-label', 'Open chat');

  // Chat icon
  launcher.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>';

  // Close icon (hidden by default)
  var closeIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var chatIcon = launcher.innerHTML;

  // Create iframe container
  var container = document.createElement('div');
  container.id = 'connect-widget-container';
  container.style.cssText = 'position:fixed;bottom:90px;' + sideProp + ':20px;z-index:9999;width:340px;height:480px;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.15);display:none;transition:opacity 0.2s,transform 0.2s;opacity:0;transform:translateY(20px);';

  var iframe = document.createElement('iframe');
  iframe.src = WIDGET_URL + '/?organizationId=' + encodeURIComponent(orgId);
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  iframe.title = 'Connect Widget';
  iframe.id = 'connect-widget-iframe';
  container.appendChild(iframe);

  document.body.appendChild(container);
  document.body.appendChild(launcher);

  var isOpen = false;

  function openWidget() {{
    isOpen = true;
    container.style.display = 'block';
    launcher.innerHTML = closeIcon;
    // Trigger reflow for animation
    void container.offsetHeight;
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    try {{ iframe.contentWindow.postMessage({{ type: 'connect:open' }}, '*'); }} catch(e) {{}}
  }}

  function closeWidget() {{
    isOpen = false;
    container.style.opacity = '0';
    container.style.transform = 'translateY(20px)';
    launcher.innerHTML = chatIcon;
    setTimeout(function() {{ container.style.display = 'none'; }}, 200);
    try {{ iframe.contentWindow.postMessage({{ type: 'connect:close' }}, '*'); }} catch(e) {{}}
  }}

  launcher.addEventListener('click', function() {{
    if (isOpen) closeWidget(); else openWidget();
  }});

  // Hover effect
  launcher.addEventListener('mouseenter', function() {{
    if (!isOpen) launcher.style.transform = 'scale(1.1)';
  }});
  launcher.addEventListener('mouseleave', function() {{
    launcher.style.transform = 'scale(1)';
  }});

  // Listen for article open/close from widget iframe — expand width for readability
  window.addEventListener('message', function(event) {{
    if (event.source !== iframe.contentWindow) return;
    if (event.data?.type === 'connect:article-open') {{
      container.style.width = '480px';
      container.style.transition = 'width 0.25s ease, opacity 0.2s, transform 0.2s';
    }} else if (event.data?.type === 'connect:article-close') {{
      container.style.width = '340px';
      container.style.transition = 'width 0.25s ease, opacity 0.2s, transform 0.2s';
    }}
  }});

  window.ConnectWidget = {{
    open: openWidget,
    close: closeWidget,
    toggle: function() {{ if (isOpen) closeWidget(); else openWidget(); }}
  }};
}})();
"""


def embed_script(request):
    return HttpResponse(EMBED_SCRIPT, content_type="application/javascript")
