from rest_framework import serializers
from django.contrib.auth import get_user_model, authenticate
from .models import Organization, User

UserModel = get_user_model()


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "timezone", "plan", "created_at"]


class SignupSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(write_only=True)
    organization_slug = serializers.SlugField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "password", "name", "organization_name", "organization_slug"]
        extra_kwargs = {"password": {"write_only": True}}

    def validate_organization_slug(self, value):
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("Organization slug already exists")
        return value

    def create(self, validated_data):
        org_data = {
            "name": validated_data.pop("organization_name"),
            "slug": validated_data.pop("organization_slug"),
        }
        organization = Organization.objects.create(**org_data)

        user = UserModel.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            username=validated_data["email"],
            first_name=validated_data.get("name", ""),
            organization=organization,
            role="admin",
            status="active",
        )
        return user


class SigninSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, data):
        user = authenticate(username=data["email"], password=data["password"])
        if not user:
            raise serializers.ValidationError("Invalid email or password")
        if user.status != "active":
            raise serializers.ValidationError("Account is not active")
        return {"user": user}


class UserSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer(read_only=True)
    name = serializers.CharField(source="first_name", read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "status", "is_online", "organization", "language", "avatar_url", "date_joined"]

    def get_avatar_url(self, obj):
        if obj.avatar:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None


class SendCodeSerializer(serializers.Serializer):
    email = serializers.EmailField()


class VerifyCodeSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)


class CompleteSignupSerializer(serializers.Serializer):
    token = serializers.CharField()
    name = serializers.CharField()
    password = serializers.CharField(min_length=8)
    organization_name = serializers.CharField()
    organization_slug = serializers.SlugField()

    def validate_organization_slug(self, value):
        from .models import Organization
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("Organization slug already exists")
        return value


class SetupWorkspaceSerializer(serializers.Serializer):
    organization_name = serializers.CharField()
    organization_slug = serializers.SlugField()

    def validate_organization_slug(self, value):
        from .models import Organization
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("Organization slug already exists")
        return value


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField(min_length=10)
    email = serializers.EmailField()
    new_password = serializers.CharField(min_length=8)
