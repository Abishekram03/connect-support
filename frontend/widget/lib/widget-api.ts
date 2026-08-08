const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function getSessionToken(orgId: string): string {
  if (typeof window === "undefined") return "";
  const key = `connect_contact_session_token_${orgId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface WidgetConfigResponse {
  organizationId: string;
  organizationName: string;
  primaryColor: string;
  companyName: string;
  logoUrl: string;
  position: "bottom-right" | "bottom-left";
  borderRadius: number;
  showBranding: boolean;
  autoGreet: boolean;
  autoGreetDelay: number;
  collectEmail: boolean;
}

export interface ConversationResponse {
  id: string;
  created_at: string;
}

export interface MessageResponse {
  id: string;
  type: string;
  body: string;
  original_body: string;
  detected_language?: string;
  sender: string | null;
  sender_name: string;
  is_from_customer: boolean;
  read_at: string | null;
  created_at: string;
  ai_reply?: {
    id: string;
    body: string;
    original_body: string;
    detected_language: string;
    confidence: number;
    escalate?: boolean;
    reason?: string;
  };
}

export function fetchWidgetConfig(organizationId: string): Promise<WidgetConfigResponse> {
  return api(`/api/widget/config?organization_id=${encodeURIComponent(organizationId)}`);
}

export function startConversation(organizationId: string, data?: {
  customer_name?: string;
  customer_email?: string;
  subject?: string;
}): Promise<ConversationResponse> {
  return api("/api/widget/conversations", {
    method: "POST",
    body: JSON.stringify({
      organization_id: organizationId,
      session_token: getSessionToken(organizationId),
      ...data,
    }),
  });
}

export interface ConversationListItem {
  id: string;
  ticket_id: number;
  status: string;
  priority: string;
  subject: string;
  customer_name: string;
  customer_email: string;
  assignee: { id: string; email: string; name: string; is_online: boolean } | null;
  first_response_at: string | null;
  handoff_requested_at: string | null;
  last_message: { id: string; body: string; created_at: string; is_from_customer: boolean } | null;
  message_count: number;
  last_message_at: string;
  created_at: string;
}

export function fetchConversations(email?: string, orgId?: string): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (orgId) {
    params.set("organization_id", orgId);
    params.set("session_token", getSessionToken(orgId));
  }
  return api(`/api/widget/conversations?${params.toString()}`);
}

export function updateConversation(conversationId: string, orgId: string, data: {
  customer_name?: string;
  customer_email?: string;
}): Promise<{ id: string; customer_name: string; customer_email: string }> {
  return api("/api/widget/conversations", {
    method: "PATCH",
    body: JSON.stringify({
      conversation_id: conversationId,
      session_token: getSessionToken(orgId),
      ...data,
    }),
  });
}

export function sendMessage(conversationId: string, body: string, orgId?: string): Promise<MessageResponse> {
  return api(`/api/widget/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body,
      ...(orgId ? { session_token: getSessionToken(orgId) } : {}),
    }),
  });
}

export function fetchMessages(conversationId: string, since?: string, orgId?: string | null): Promise<MessageResponse[]> {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (orgId) params.set("session_token", getSessionToken(orgId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return api(`/api/widget/conversations/${conversationId}/messages${qs}`);
}
