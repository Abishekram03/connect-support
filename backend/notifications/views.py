from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from .models import Notification
from .serializers import NotificationSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notification_list(request):
    user = request.user
    org = getattr(user, "organization", None)
    if not org:
        return Response({"results": []})

    qs = Notification.objects.filter(organization=org)

    after = request.query_params.get("after")
    if after:
        try:
            after_dt = timezone.datetime.fromisoformat(after.replace("Z", "+00:00"))
            qs = qs.filter(created_at__gt=after_dt)
        except (ValueError, TypeError):
            pass

    limit = min(int(request.query_params.get("limit", 8)), 50)
    notifications = qs[:limit]
    serializer = NotificationSerializer(notifications, many=True)
    return Response({"results": serializer.data})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def notification_mark_read(request, pk):
    try:
        n = Notification.objects.get(pk=pk, organization=request.user.organization)
    except Notification.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    n.read = True
    n.save(update_fields=["read"])
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def notification_mark_all_read(request):
    org = getattr(request.user, "organization", None)
    if org:
        Notification.objects.filter(organization=org, read=False).update(read=True)
    return Response({"ok": True})


def create_notification(org, notification_type, title, body="", conversation=None, recipient=None):
    try:
        n = Notification.objects.create(
            organization=org,
            notification_type=notification_type,
            title=title,
            body=body,
            conversation=conversation,
            recipient=recipient,
        )
        return n
    except Exception:
        return None
