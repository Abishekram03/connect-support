from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Membership, Team, TeamMembership, Invitation

User = get_user_model()


class UserMinimalSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="first_name", read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "name", "is_online"]


class MembershipSerializer(serializers.ModelSerializer):
    user = UserMinimalSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True, required=False)
    invited_by = UserMinimalSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user", "user_id", "organization", "role", "status", "invited_by", "created_at"]
        read_only_fields = ["id", "organization", "invited_by", "created_at"]


class InvitationSerializer(serializers.ModelSerializer):
    invited_by = UserMinimalSerializer(read_only=True)

    class Meta:
        model = Invitation
        fields = ["id", "email", "role", "status", "token", "invited_by", "expires_at", "created_at"]
        read_only_fields = ["id", "token", "invited_by", "expires_at", "created_at"]


class InvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=["admin", "agent"], default="agent")


class TeamMembershipSerializer(serializers.ModelSerializer):
    user = UserMinimalSerializer(read_only=True)

    class Meta:
        model = TeamMembership
        fields = ["id", "user", "team", "role", "created_at"]
        read_only_fields = ["id", "created_at"]


class TeamSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ["id", "name", "description", "organization", "member_count", "created_at", "updated_at"]
        read_only_fields = ["id", "organization", "created_at", "updated_at"]

    def get_member_count(self, obj):
        return obj.memberships.count()


class TeamDetailSerializer(serializers.ModelSerializer):
    members = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ["id", "name", "description", "organization", "member_count", "members", "created_at", "updated_at"]
        read_only_fields = ["id", "organization", "created_at", "updated_at"]

    def get_member_count(self, obj):
        return obj.memberships.count()

    def get_members(self, obj):
        return TeamMembershipSerializer(obj.memberships.select_related("user").all(), many=True).data


class TeamCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, default="")


class TeamUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, required=False)
    description = serializers.CharField(required=False)


class AddMembersSerializer(serializers.Serializer):
    user_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1)


class OrgSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    slug = serializers.CharField()
    plan = serializers.CharField()
    role = serializers.CharField()
    is_primary = serializers.BooleanField()
