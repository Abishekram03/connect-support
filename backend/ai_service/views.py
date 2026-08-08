import logging
from django.utils import timezone
from rest_framework import status, permissions
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .models import AIConfig, KnowledgeSource, DocumentChunk, AIReplyLog, SLAConfig
from .serializers import (
    AIConfigSerializer,
    KnowledgeSourceSerializer,
    KnowledgeSourceListSerializer,
    DocumentChunkSerializer,
    AIReplyLogSerializer,
    AutoReplyRequestSerializer,
    SLAConfigSerializer,
)
from .rag import (
    get_provider,
    sync_source_to_chunks,
    generate_reply,
    generate_reply_options,
    suggest_reply,
    summarize_conversation,
    suggest_next_steps,
)
from conversations.models import Conversation, Message

logger = logging.getLogger(__name__)


def get_user_org(user):
    if hasattr(user, "organization") and user.organization:
        return user.organization
    from teams.models import Membership
    membership = Membership.objects.filter(user=user, status="active").first()
    if membership:
        return membership.organization
    return None


def get_user_role(user):
    if hasattr(user, "role") and user.role in ("admin", "owner"):
        return user.role
    from teams.models import Membership
    membership = Membership.objects.filter(user=user, status="active").first()
    if membership:
        return membership.role
    return "agent"


def require_admin_or_owner(user):
    return get_user_role(user) in ("admin", "owner")


# ── AI Config ──

@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def ai_config_detail(request):
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    config, _ = AIConfig.objects.get_or_create(organization=org)

    if request.method == "GET":
        serializer = AIConfigSerializer(config)
        return Response(serializer.data)

    if not require_admin_or_owner(request.user):
        return Response(
            {"detail": "Only admins and owners can modify AI configuration"},
            status=status.HTTP_403_FORBIDDEN,
        )

    # For PATCH, only update provider_api_key if it's not masked
    update_data = dict(request.data)
    if "provider_api_key" in update_data:
        key_val = update_data["provider_api_key"]
        if key_val and ("****" in key_val or len(key_val) < 10):
            # Client sent masked key — don't overwrite the real one
            del update_data["provider_api_key"]

    serializer = AIConfigSerializer(config, data=update_data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


# ── Knowledge Sources ──

@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
def knowledge_source_list(request):
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == "GET":
        sources = KnowledgeSource.objects.filter(organization=org)
        serializer = KnowledgeSourceListSerializer(sources, many=True)
        return Response(serializer.data)

    serializer = KnowledgeSourceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(organization=org)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def knowledge_source_detail(request, pk):
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        source = KnowledgeSource.objects.get(pk=pk, organization=org)
    except KnowledgeSource.DoesNotExist:
        return Response({"detail": "Source not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        serializer = KnowledgeSourceSerializer(source)
        return Response(serializer.data)

    if request.method == "DELETE":
        source.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = KnowledgeSourceSerializer(source, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


# ── Sync & Indexing ──

@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def sync_source(request, pk):
    """Re-index a single knowledge source."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        source = KnowledgeSource.objects.get(pk=pk, organization=org)
    except KnowledgeSource.DoesNotExist:
        return Response({"detail": "Source not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        provider = get_provider(org)
        chunk_count = sync_source_to_chunks(source, provider)
        return Response({"chunk_count": chunk_count, "is_indexed": True})
    except ValueError:
        return Response({"detail": "Sync configuration error. Check your API settings."}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        logger.error("Sync source error for source %s", pk, exc_info=True)
        return Response({"detail": "Sync failed. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def sync_all_sources(request):
    """Re-index all knowledge sources for the org."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        provider = get_provider(org)
    except ValueError:
        return Response({"detail": "AI not configured. Check your API settings."}, status=status.HTTP_400_BAD_REQUEST)

    sources = KnowledgeSource.objects.filter(organization=org)
    total_chunks = 0
    errors = []

    for source in sources:
        try:
            chunk_count = sync_source_to_chunks(source, provider)
            total_chunks += chunk_count
        except Exception:
            logger.error("Sync source %s failed", source.id, exc_info=True)
            errors.append({"source_id": str(source.id), "error": "Sync failed"})

    return Response({
        "total_chunks": total_chunks,
        "sources_synced": sources.count() - len(errors),
        "errors": errors,
    })


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def sync_kb_to_sources(request):
    """Sync KB articles & FAQs into KnowledgeSource entries."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    from knowledge_base.models import Article, FAQ

    synced = 0

    # Sync published articles
    for article in Article.objects.filter(organization=org, published=True):
        source, created = KnowledgeSource.objects.update_or_create(
            organization=org,
            source_type="kb_article",
            external_id=str(article.id),
            defaults={
                "title": article.title,
                "content": article.content,
            },
        )
        if created or source.content != article.content:
            source.is_indexed = False
            source.save(update_fields=["is_indexed"])
            synced += 1

    # Sync all FAQs
    for faq in FAQ.objects.filter(organization=org):
        source, created = KnowledgeSource.objects.update_or_create(
            organization=org,
            source_type="kb_faq",
            external_id=str(faq.id),
            defaults={
                "title": faq.question,
                "content": faq.answer,
            },
        )
        if created or source.content != faq.answer:
            source.is_indexed = False
            source.save(update_fields=["is_indexed"])
            synced += 1

    return Response({"synced": synced})


# ── Widget Auto-Reply ──

class WidgetAutoReplyThrottle(AnonRateThrottle):
    rate = "20/minute"


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
@throttle_classes([WidgetAutoReplyThrottle])
def widget_auto_reply(request):
    """Handle widget message and return AI auto-reply if enabled."""
    serializer = AutoReplyRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    conversation_id = serializer.validated_data["conversation_id"]
    message_text = serializer.validated_data["message"]

    try:
        conversation = Conversation.objects.get(pk=conversation_id)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    org = conversation.organization
    config = AIConfig.objects.filter(organization=org).first()

    if not config or not config.auto_reply_enabled:
        return Response({"reply": None, "escalate": False})

    # Per-org AI rate limit (30/min)
    from django.core.cache import cache
    org_ai_rate_key = f"widget_ai_rate:{org.id}"
    ai_count = cache.get(org_ai_rate_key, 0)
    if ai_count >= 30:
        return Response({
            "reply": None,
            "escalate": True,
            "escalation_reason": "rate_limit_exceeded",
        })
    cache.set(org_ai_rate_key, ai_count + 1, timeout=60)

    # Check max AI turns
    ai_reply_count = Message.objects.filter(
        conversation=conversation, is_from_customer=False, sender__isnull=True
    ).count()

    if ai_reply_count >= config.max_ai_turns:
        return Response({
            "reply": None,
            "escalate": True,
            "escalation_reason": "max_ai_turns_reached",
        })

    try:
        provider = get_provider(org)
    except ValueError as e:
        logger.error(f"AI provider error: {e}")
        return Response({"reply": None, "escalate": True, "escalation_reason": "provider_error"})

    # Get conversation history
    messages = list(
        Message.objects.filter(conversation=conversation)
        .order_by("created_at")
        .values("body", "is_from_customer")
    )

    # Generate reply
    try:
        result = generate_reply(org, message_text, messages, provider, config)
    except Exception as e:
        logger.error(f"AI generate reply error: {e}")
        return Response({
            "reply": None,
            "escalate": True,
            "escalation_reason": "generation_error",
        })

    # Save the AI reply if not escalating
    if not result["escalate"]:
        ai_message = Message.objects.create(
            conversation=conversation,
            type="reply",
            body=result["content"],
            sender=None,  # AI has no user account
            is_from_customer=False,
        )
        conversation.last_message_at = timezone.now()
        conversation.save(update_fields=["last_message_at"])

    # Log the AI reply
    ai_log = AIReplyLog.objects.create(
        conversation=conversation,
        organization=org,
        model_used=config.model_name,
        prompt_tokens=result["prompt_tokens"],
        completion_tokens=result["completion_tokens"],
        confidence=result["confidence"],
        escalated=result["escalate"],
        escalation_reason=result["escalation_reason"],
        sources_used=result["sources"],
        response_text=result["content"],
    )

    return Response({
        "reply": result["content"] if not result["escalate"] else None,
        "confidence": result["confidence"],
        "escalate": result["escalate"],
        "escalation_reason": result["escalation_reason"],
        "sources": result["sources"],
        "ai_log_id": str(ai_log.id),
    })


# ── Agent Copilot ──

@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def reply_options_view(request):
    """Generate 2 AI draft replies in the agent's preferred language."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    conversation_id = request.data.get("conversation_id")
    if not conversation_id:
        return Response({"detail": "conversation_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        conversation = Conversation.objects.get(pk=conversation_id, organization=org)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    config = AIConfig.objects.filter(organization=org).first()
    if not config:
        return Response({"detail": "AI not configured"}, status=status.HTTP_400_BAD_REQUEST)

    messages = list(
        Message.objects.filter(conversation=conversation)
        .order_by("created_at")
        .values("body", "is_from_customer")
    )

    try:
        provider = get_provider(org)
        agent_language = getattr(request.user, "language", "en") or "en"
        human_engaged = conversation.first_response_at is not None or conversation.handoff_requested_at is not None
        options = generate_reply_options(
            org, messages, provider, config,
            agent_language=agent_language,
            human_engaged=human_engaged,
        )
        return Response({"options": options, "language": agent_language})
    except Exception:
        logger.error("Reply options error for conversation %s", conversation_id, exc_info=True)
        return Response({"detail": "AI reply generation failed. Please try again."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def suggest_reply_view(request):
    """Get 3 AI-suggested replies for the current conversation."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    conversation_id = request.data.get("conversation_id")
    if not conversation_id:
        return Response({"detail": "conversation_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        conversation = Conversation.objects.get(pk=conversation_id, organization=org)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    config = AIConfig.objects.filter(organization=org).first()
    if not config:
        return Response({"detail": "AI not configured"}, status=status.HTTP_400_BAD_REQUEST)

    messages = list(
        Message.objects.filter(conversation=conversation)
        .order_by("created_at")
        .values("body", "is_from_customer")
    )

    try:
        provider = get_provider(org)
        human_engaged = conversation.first_response_at is not None or conversation.handoff_requested_at is not None
        suggestions = suggest_reply(org, messages, provider, config, human_engaged=human_engaged)
        return Response({"suggestions": suggestions})
    except Exception:
        logger.error("Suggest reply error for conversation %s", conversation_id, exc_info=True)
        return Response({"detail": "AI suggestion failed. Please try again."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def summarize_view(request):
    """Summarize a conversation."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    conversation_id = request.data.get("conversation_id")
    if not conversation_id:
        return Response({"detail": "conversation_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        conversation = Conversation.objects.get(pk=conversation_id, organization=org)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    messages = list(
        Message.objects.filter(conversation=conversation)
        .order_by("created_at")
        .values("body", "is_from_customer")
    )

    try:
        provider = get_provider(org)
        summary = summarize_conversation(org, messages, provider)
        return Response({"summary": summary})
    except Exception:
        logger.error("Summarize error for conversation %s", conversation_id, exc_info=True)
        return Response({"detail": "Summarization failed. Please try again."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def next_steps_view(request):
    """Suggest next steps for a conversation."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    conversation_id = request.data.get("conversation_id")
    if not conversation_id:
        return Response({"detail": "conversation_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        conversation = Conversation.objects.get(pk=conversation_id, organization=org)
    except Conversation.DoesNotExist:
        return Response({"detail": "Conversation not found"}, status=status.HTTP_404_NOT_FOUND)

    messages = list(
        Message.objects.filter(conversation=conversation)
        .order_by("created_at")
        .values("body", "is_from_customer")
    )

    try:
        provider = get_provider(org)
        steps = suggest_next_steps(org, messages, provider)
        return Response({"steps": steps})
    except Exception:
        logger.error("Next steps error for conversation %s", conversation_id, exc_info=True)
        return Response({"detail": "AI suggestion failed. Please try again."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ── AI Reply Logs ──

@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def ai_reply_logs(request):
    """List AI reply logs for the organization."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    logs = AIReplyLog.objects.filter(organization=org)[:50]
    serializer = AIReplyLogSerializer(logs, many=True)
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def ai_analytics(request):
    """Get AI usage analytics for the organization."""
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    from django.db.models import Avg, Count, Sum, Q
    from datetime import timedelta

    period = request.query_params.get("period", "7d")
    now = timezone.now()
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "30d":
        start = now - timedelta(days=30)
    else:
        start = now - timedelta(days=7)

    logs = AIReplyLog.objects.filter(organization=org, created_at__gte=start)

    # Total replies
    total_replies = logs.count()

    # Token usage
    total_prompt_tokens = logs.aggregate(total=Sum("prompt_tokens"))["total"] or 0
    total_completion_tokens = logs.aggregate(total=Sum("completion_tokens"))["total"] or 0
    total_tokens = total_prompt_tokens + total_completion_tokens

    # Avg confidence
    avg_confidence = logs.aggregate(avg=Avg("confidence"))["avg"]
    if avg_confidence is not None:
        avg_confidence = round(avg_confidence, 3)

    # Escalation stats
    escalated = logs.filter(escalated=True).count()
    escalation_rate = None
    if total_replies > 0:
        escalation_rate = round((escalated / total_replies) * 100, 1)

    # Escalation reasons breakdown
    escalation_reasons = (
        logs.filter(escalated=True)
        .values("escalation_reason")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    escalation_breakdown = {
        item["escalation_reason"] or "unknown": item["count"]
        for item in escalation_reasons
    }

    # Model usage breakdown
    model_usage = (
        logs.values("model_used")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    model_breakdown = {item["model_used"]: item["count"] for item in model_usage}

    # AI resolved (not escalated)
    ai_resolved = total_replies - escalated

    # Daily trend
    from django.db.models.functions import TruncDate
    daily_data = (
        logs
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(
            replies=Count("id"),
            avg_confidence=Avg("confidence"),
            escalated_count=Count("id", filter=Q(escalated=True)),
        )
        .order_by("day")
    )
    daily_trend = [
        {
            "date": item["day"].isoformat() if item["day"] else None,
            "replies": item["replies"],
            "avg_confidence": round(item["avg_confidence"], 3) if item["avg_confidence"] else 0,
            "escalated": item["escalated_count"],
        }
        for item in daily_data
    ]

    # Recent logs
    recent_logs = logs[:10]
    recent_data = [
        {
            "id": str(log.id),
            "model_used": log.model_used,
            "confidence": log.confidence,
            "escalated": log.escalated,
            "escalation_reason": log.escalation_reason,
            "prompt_tokens": log.prompt_tokens,
            "completion_tokens": log.completion_tokens,
            "created_at": log.created_at.isoformat(),
            "conversation_id": str(log.conversation_id),
        }
        for log in recent_logs
    ]

    return Response({
        "period": period,
        "total_replies": total_replies,
        "tokens": {
            "total": total_tokens,
            "prompt": total_prompt_tokens,
            "completion": total_completion_tokens,
        },
        "avg_confidence": avg_confidence,
        "escalation": {
            "total": escalated,
            "rate": escalation_rate,
            "reasons": escalation_breakdown,
        },
        "ai_resolved": ai_resolved,
        "model_usage": model_breakdown,
        "daily_trend": daily_trend,
        "recent_logs": recent_data,
    })


# ── SLA Config ──

@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def sla_config_detail(request):
    org = get_user_org(request.user)
    if not org:
        return Response({"detail": "No organization found"}, status=status.HTTP_400_BAD_REQUEST)

    config, _ = SLAConfig.objects.get_or_create(organization=org)

    if request.method == "GET":
        serializer = SLAConfigSerializer(config)
        return Response(serializer.data)

    if not require_admin_or_owner(request.user):
        return Response(
            {"detail": "Only admins and owners can modify SLA configuration"},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = SLAConfigSerializer(config, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)
