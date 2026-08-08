from rest_framework import serializers
from .models import Conversation, Message
from accounts.serializers import UserSerializer


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "type", "body", "original_body", "detected_language", "sender", "sender_name", "is_from_customer", "read_at", "created_at"]
        read_only_fields = ["id", "sender_name", "read_at", "created_at"]

    def get_sender_name(self, obj):
        if obj.sender:
            return obj.sender.first_name or obj.sender.email
        if not obj.is_from_customer:
            return "Kai"
        return "Customer"


class MessageCreateSerializer(serializers.Serializer):
    body = serializers.CharField()
    type = serializers.ChoiceField(choices=["reply", "note"], default="reply")


class TeamMinimalSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True, default="")


class ConversationListSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True)
    team = TeamMinimalSerializer(read_only=True)
    last_message = serializers.SerializerMethodField()
    message_count = serializers.SerializerMethodField()
    sla_status = serializers.SerializerMethodField()
    sla_time_remaining = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "ticket_id", "status", "priority", "channel", "subject",
            "customer_name", "customer_email", "customer_avatar",
            "assignee", "team", "last_message", "message_count",
            "assigned_at", "first_response_at", "handoff_requested_at", "resolved_at",
            "sla_deadline", "sla_breached", "sla_status", "sla_time_remaining",
            "last_message_at", "created_at", "updated_at",
        ]

    def get_last_message(self, obj):
        msg = obj.messages.order_by("-created_at").first()
        if msg:
            return {"id": str(msg.id), "body": msg.body[:100], "created_at": msg.created_at.isoformat(), "is_from_customer": msg.is_from_customer}
        return None

    def get_message_count(self, obj):
        return obj.messages.count()

    def get_sla_status(self, obj):
        return obj.get_sla_status()

    def get_sla_time_remaining(self, obj):
        if not obj.sla_deadline:
            return None
        from django.utils import timezone
        from datetime import timedelta
        now = timezone.now()
        if obj.sla_breached or now > obj.sla_deadline:
            return 0
        remaining = (obj.sla_deadline - now).total_seconds()
        return int(remaining)


class ConversationDetailSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True)
    team = TeamMinimalSerializer(read_only=True)
    messages = MessageSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = "__all__"


class ConversationUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["open", "pending", "closed"], required=False)
    priority = serializers.ChoiceField(choices=["low", "normal", "high", "urgent"], required=False)
