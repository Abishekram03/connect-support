import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class Organization(models.Model):
    PLAN_CHOICES = [
        ("free", "Free"),
        ("starter", "Starter"),
        ("pro", "Pro"),
        ("enterprise", "Enterprise"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, max_length=255)
    timezone = models.CharField(max_length=64, default="UTC")
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="free")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class User(AbstractUser):
    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("agent", "Agent"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="members", null=True, blank=True
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="agent")
    status = models.CharField(max_length=20, default="invited")
    is_online = models.BooleanField(default=True, help_text="Presence status — offline agents are skipped by auto-assignment")
    language = models.CharField(max_length=10, default="en", help_text="Preferred language for auto-translation")
    avatar = models.ImageField(upload_to="avatars/", null=True, blank=True)
    invited_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.email


class VerificationCode(models.Model):
    email = models.EmailField()
    code = models.CharField(max_length=6)
    purpose = models.CharField(max_length=20, default="signup")
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "verification_codes"

    def __str__(self):
        return f"{self.email} - {self.code}"
