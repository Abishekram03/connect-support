import { api, setTokens, clearTokens } from "./api-client";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  plan: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  is_online: boolean;
  organization: Organization;
  language: string;
  avatar_url: string | null;
  date_joined: string;
}

export interface AuthResponse {
  user: User;
  access: string;
  refresh: string;
  needs_workspace?: boolean;
}

interface StoredUser extends User {
  organizationName?: string;
}

function storeUser(user: User) {
  localStorage.setItem("user", JSON.stringify(user));
}

function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function sendCode(email: string): Promise<{
  detail: string;
  user_exists: boolean;
  name_hint: string;
}> {
  return api.post("/api/auth/send-code", { email });
}

export async function verifyCode(
  email: string,
  code: string
): Promise<{ action: "signin"; user: User; access: string; refresh: string } | { action: "signup"; temp_token: string }> {
  return api.post("/api/auth/verify-code", { email, code });
}

export async function completeSignup(
  token: string,
  name: string,
  password: string,
  organizationName: string,
  organizationSlug: string
): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>("/api/auth/complete-signup", {
    token,
    name,
    password,
    organization_name: organizationName,
    organization_slug: organizationSlug,
  });
  setTokens(data.access, data.refresh);
  storeUser(data.user);
  return data;
}

export async function signin(email: string, password: string): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>("/api/auth/signin", { email, password });
  setTokens(data.access, data.refresh);
  storeUser(data.user);
  return data;
}

export async function signup(
  email: string,
  password: string,
  name: string,
  organizationName: string,
  organizationSlug: string
): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>("/api/auth/signup", {
    email,
    password,
    name,
    organization_name: organizationName,
    organization_slug: organizationSlug,
  });
  setTokens(data.access, data.refresh);
  storeUser(data.user);
  return data;
}

export async function logout(refreshToken?: string | null): Promise<void> {
  try {
    await api.post("/api/auth/logout", { refresh: refreshToken });
  } catch {
    // ignore logout errors
  }
  clearTokens();
}

export async function getMe(): Promise<User> {
  const user = await api.get<User>("/api/auth/me");
  storeUser(user);
  return user;
}

export function getCurrentUser(): User | null {
  return getStoredUser();
}

export async function setupWorkspace(
  organizationName: string,
  organizationSlug: string
): Promise<{ user: User }> {
  return api.post("/api/auth/setup-workspace", {
    organization_name: organizationName,
    organization_slug: organizationSlug,
  });
}

export async function updateProfile(name: string): Promise<User> {
  const data = await api.patch<User>("/api/auth/me", { name });
  storeUser(data);
  return data;
}

export async function updatePresence(isOnline: boolean): Promise<User> {
  const data = await api.patch<User>("/api/auth/me", { is_online: isOnline });
  storeUser(data);
  return data;
}

export async function uploadAvatar(file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData();
  formData.append("avatar", file);
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/auth/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function deleteAvatar(): Promise<void> {
  await api.post("/api/auth/avatar/delete", {});
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await api.post("/api/auth/change-password", {
    old_password: oldPassword,
    new_password: newPassword,
  });
}

export { getStoredUser, storeUser, clearTokens };
