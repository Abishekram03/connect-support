import uuid
from datetime import timedelta

from django.db import models
from django.conf import settings
from django.utils import timezone


class Conversation(models.Model):
    STATUS_CHOICES = [
        ("open", "Open"),
        ("pending", "Pending"),
        ("closed", "Closed"),
    ]

    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("normal", "Normal"),
        ("high", "High"),
        ("urgent", "Urgent"),
    ]

    CHANNEL_CHOICES = [
        ("widget", "Widget"),
        ("email", "Email"),
        ("api", "API"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "accounts.Organization", on_delete=models.CASCADE, related_name="conversations"
    )
    ticket_id = models.PositiveIntegerField(editable=False, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default="widget")
    subject = models.CharField(max_length=255, blank=True, default="")
    customer_name = models.CharField(max_length=255, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    customer_avatar = models.URLField(blank=True, default="")
    session_token = models.CharField(max_length=64, blank=True, default="", db_index=True)
    browser = models.JSONField(blank=True, default=dict)
    location = models.CharField(max_length=255, blank=True, default="")
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_conversations"
    )
    team = models.ForeignKey(
        "teams.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="conversations"
    )

    # SLA fields
    assigned_at = models.DateTimeField(null=True, blank=True)
    first_response_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    sla_deadline = models.DateTimeField(null=True, blank=True)
    sla_breached = models.BooleanField(default=False)

    # AI handoff — set when the AI hands the conversation to a human (escalation / rate limit)
    handoff_requested_at = models.DateTimeField(null=True, blank=True)

    last_message_at = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "conversations"
        ordering = ["-last_message_at"]

    def save(self, *args, **kwargs):
        if self.ticket_id is None:
            max_ticket = Conversation.objects.filter(
                organization=self.organization
            ).aggregate(models.Max("ticket_id"))["ticket_id__max"]
            self.ticket_id = (max_ticket or 0) + 1
        super().save(*args, **kwargs)

    def compute_sla_deadline(self):
        """Compute SLA deadline based on priority and org SLA config."""
        from ai_service.models import SLAConfig
        try:
            sla_config = SLAConfig.objects.get(organization=self.organization)
        except SLAConfig.DoesNotExist:
            from django.conf import settings as django_settings
            sla_config = None

        priority_hours = {
            "urgent": getattr(sla_config, "urgent_hours", 1) if sla_config else 1,
            "high": getattr(sla_config, "high_hours", 4) if sla_config else 4,
            "normal": getattr(sla_config, "normal_hours", 8) if sla_config else 8,
            "low": getattr(sla_config, "low_hours", 24) if sla_config else 24,
        }
        hours = priority_hours.get(self.priority, 8)
        return timezone.now() + timedelta(hours=hours)

    def get_sla_status(self):
        """Return SLA status: 'on_track', 'warning', 'breached', or 'none'."""
        if not self.sla_deadline:
            return "none"
        now = timezone.now()
        if self.sla_breached or now > self.sla_deadline:
            return "breached"
        from ai_service.models import SLAConfig
        try:
            sla_config = SLAConfig.objects.get(organization=self.organization)
            warn_minutes = sla_config.warn_before_minutes
        except SLAConfig.DoesNotExist:
            warn_minutes = 15
        if self.sla_deadline - now <= timedelta(minutes=warn_minutes):
            return "warning"
        return "on_track"

    def __str__(self):
        return f"{self.customer_name or 'Unknown'} - {self.subject or 'No subject'}"


class Message(models.Model):
    TYPE_CHOICES = [
        ("reply", "Reply"),
        ("note", "Note"),
        ("system", "System"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="reply")
    body = models.TextField()
    original_body = models.TextField(blank=True, default="", help_text="Original text before translation")
    detected_language = models.CharField(max_length=10, blank=True, default="", help_text="Detected language code")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    is_from_customer = models.BooleanField(default=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messages"
        ordering = ["created_at"]

    def __str__(self):
        return f"[{self.type}] {self.body[:60]}"
