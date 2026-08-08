import { api } from "./api-client";

export interface Membership {
  id: string;
  user: { id: string; email: string; name: string; is_online: boolean };
  organization: string;
  role: "owner" | "admin" | "agent";
  status: "active" | "invited" | "suspended";
  invited_by: { id: string; email: string; name: string } | null;
  created_at: string;
  open_conversations: number;
  total_conversations: number;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  organization: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeamDetail extends Team {
  members: TeamMembership[];
}

export interface TeamMembership {
  id: string;
  user: { id: string; email: string; name: string; is_online: boolean };
  team: string;
  role: "admin" | "member";
  created_at: string;
  open_conversations: number;
  total_conversations: number;
}

export interface Invitation {
  id: string;
  email: string;
  role: "admin" | "agent";
  status: "pending" | "accepted" | "expired";
  token: string;
  invited_by: { id: string; email: string; name: string } | null;
  expires_at: string;
  created_at: string;
}

export interface UserOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: "owner" | "admin" | "agent";
  is_primary: boolean;
}

export interface TeamAnalyticsMember {
  user: { id: string; email: string; name: string };
  role: string;
  conversations_handled: number;
  open: number;
  closed: number;
  messages_sent: number;
}

export interface TeamAnalytics {
  team: { id: string; name: string; description: string };
  conversations: { total: number; open: number; pending: number; closed: number };
  total_messages: number;
  members: TeamAnalyticsMember[];
  recent_conversations: Array<{
    id: string;
    customer_name: string;
    subject: string;
    status: string;
    assignee: string | null;
    last_message_at: string;
  }>;
}

export const teamsApi = {
  listMembers: () => api.get<Membership[]>("/api/members"),
  inviteMember: (data: { email: string; role?: string }) =>
    api.post<Invitation>("/api/members/invite", data),
  updateMemberRole: (id: string, role: string) =>
    api.patch<Membership>(`/api/members/${id}`, { role }),
  removeMember: (id: string) => api.delete(`/api/members/${id}/remove`),

  listInvitations: () => api.get<Invitation[]>("/api/invitations"),
  resendInvitation: (id: string) => api.post<Invitation>(`/api/invitations/${id}/resend`),
  cancelInvitation: (id: string) => api.delete(`/api/invitations/${id}`),

  listTeams: () => api.get<Team[]>("/api/teams"),
  createTeam: (data: { name: string; description?: string }) =>
    api.post<TeamDetail>("/api/teams/create", data),
  getTeam: (id: string) => api.get<TeamDetail>(`/api/teams/${id}`),
  updateTeam: (id: string, data: { name?: string; description?: string }) =>
    api.patch<TeamDetail>(`/api/teams/${id}/update`, data),
  deleteTeam: (id: string) => api.delete(`/api/teams/${id}/delete`),
  addTeamMembers: (teamId: string, userIds: string[], role?: string) =>
    api.post(`/api/teams/${teamId}/members`, { user_ids: userIds, role: role || "member" }),
  removeTeamMember: (teamId: string, userId: string) =>
    api.delete(`/api/teams/${teamId}/members/${userId}`),

  getUserOrgs: () => api.get<UserOrg[]>("/api/user-orgs"),
  switchOrg: (orgId: string) => api.post<{ id: string; name: string; slug: string; plan: string; timezone: string; created_at: string }>("/api/switch-org", { org_id: orgId }),

  getTeamAnalytics: (teamId: string) => api.get<TeamAnalytics>(`/api/teams/${teamId}/analytics`),
  updateTeamMemberRole: (teamId: string, userId: string, role: string) =>
    api.patch<{ user: { id: string; email: string; name: string }; role: string }>(`/api/teams/${teamId}/members/${userId}/role`, { role }),
};
