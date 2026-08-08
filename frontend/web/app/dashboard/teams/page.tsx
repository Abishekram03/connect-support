"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  X,
  Search,
  Check,
  Shield,
  UserPlus,
  Users,
  Trash2,
  Clock,
  RefreshCw,
  Loader2,
  Mail,
  ChevronDown,
  Pencil,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { api } from "@/lib/api-client";
import {
  teamsApi,
  type Membership,
  type Team,
  type TeamDetail,
  type Invitation,
  type TeamAnalytics,
} from "@/lib/teams-service";

type Tab = "teams" | "members";
type TeamTab = "members" | "analytics";
type MemberTab = "details" | "analytics";

export default function TeamsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>("members");
  const [teamTab, setTeamTab] = useState<TeamTab>("members");
  const [memberTab, setMemberTab] = useState<MemberTab>("details");
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [search, setSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalytics | null>(null);
  const [selectedMember, setSelectedMember] = useState<Membership | null>(null);
  const [memberAnalytics, setMemberAnalytics] = useState<any>(null);
  const [memberAnalyticsLoading, setMemberAnalyticsLoading] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showInviteMember, setShowInviteMember] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [newTeam, setNewTeam] = useState({ name: "", description: "" });
  const [editTeam, setEditTeam] = useState<{ name: string; description: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent">("agent");
  const [addMemberRole, setAddMemberRole] = useState<"admin" | "member">("member");
  const [teamMemberRoleTarget, setTeamMemberRoleTarget] = useState<{ userId: string; currentRole: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [teamsData, membersData, invitationsData] = await Promise.all([
        teamsApi.listTeams(),
        teamsApi.listMembers(),
        teamsApi.listInvitations(),
      ]);
      setTeams(teamsData);
      setMembers(membersData);
      setInvitations(invitationsData);
    } catch (e: any) {
      toast.error(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredMembers = members.filter(
    (m) =>
      m.user.name.toLowerCase().includes(search.toLowerCase()) ||
      m.user.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateTeam = async () => {
    if (!newTeam.name.trim()) return;
    try {
      const team = await teamsApi.createTeam(newTeam);
      const { members: _, ...teamWithoutMembers } = team;
      setTeams([...teams, teamWithoutMembers]);
      setNewTeam({ name: "", description: "" });
      setShowCreateTeam(false);
      setSelectedTeam(team);
      toast.success("Team created");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    const ok = await confirm({
      title: "Delete Team",
      message: "Are you sure you want to delete this team? This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await teamsApi.deleteTeam(id);
      setTeams(teams.filter((t) => t.id !== id));
      if (selectedTeam?.id === id) setSelectedTeam(null);
      toast.success("Team deleted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUpdateTeam = async () => {
    if (!selectedTeam || !editTeam?.name.trim()) return;
    setActionLoading(true);
    try {
      await teamsApi.updateTeam(selectedTeam.id, editTeam);
      const updated = await teamsApi.getTeam(selectedTeam.id);
      setSelectedTeam(updated);
      const { members: _, ...updatedBase } = updated;
      setTeams(teams.map((t) => (t.id === updatedBase.id ? updatedBase : t)));
      setEditTeam(null);
      toast.success("Team updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) return;
    setActionLoading(true);
    try {
      const invitation = await teamsApi.inviteMember({
        email: inviteEmail,
        role: inviteRole,
      });
      setInvitations([...invitations, invitation]);
      setInviteEmail("");
      setInviteRole("agent");
      setShowInviteMember(false);
      toast.success("Invitation sent");
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (membership: Membership) => {
    const ok = await confirm({
      title: "Remove Member",
      message: `Are you sure you want to remove ${membership.user.name || membership.user.email}? This action cannot be undone.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setActionLoading(true);
    try {
      await teamsApi.removeMember(membership.id);
      setMembers(members.filter((m) => m.id !== membership.id));
      if (selectedMember?.id === membership.id) setSelectedMember(null);
      toast.success("Member removed");
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangeRole = async (membership: Membership, newRole: "admin" | "agent") => {
    setActionLoading(true);
    try {
      const updated = await teamsApi.updateMemberRole(membership.id, newRole);
      setMembers(members.map((m) => (m.id === membership.id ? updated : m)));
      if (selectedMember?.id === membership.id) {
        setSelectedMember({ ...selectedMember, role: newRole });
      }
      setShowRoleDropdown(false);
      toast.success("Role updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMembersToTeam = async () => {
    if (!selectedTeam || selectedMemberIds.length === 0) return;
    try {
      await teamsApi.addTeamMembers(selectedTeam.id, selectedMemberIds, addMemberRole);
      const updated = await teamsApi.getTeam(selectedTeam.id);
      setSelectedTeam(updated);
      const { members: _, ...updatedBase } = updated;
      setTeams(teams.map((t) => (t.id === updatedBase.id ? updatedBase : t)));
      setShowAddMembers(false);
      setSelectedMemberIds([]);
      setAddMemberRole("member");
      toast.success("Members added");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemoveTeamMember = async (teamId: string, userId: string) => {
    const ok = await confirm({
      title: "Remove from Team",
      message: "Are you sure you want to remove this member from the team?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await teamsApi.removeTeamMember(teamId, userId);
      const updated = await teamsApi.getTeam(teamId);
      setSelectedTeam(updated);
      const { members: _, ...updatedBase } = updated;
      setTeams(teams.map((t) => (t.id === updatedBase.id ? updatedBase : t)));
      toast.success("Member removed from team");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleChangeTeamMemberRole = async (userId: string, newRole: "admin" | "member") => {
    if (!selectedTeam) return;
    setActionLoading(true);
    try {
      await teamsApi.updateTeamMemberRole(selectedTeam.id, userId, newRole);
      const updated = await teamsApi.getTeam(selectedTeam.id);
      setSelectedTeam(updated);
      setTeamMemberRoleTarget(null);
      toast.success("Role updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const loadTeamAnalytics = async (teamId: string) => {
    try {
      const data = await teamsApi.getTeamAnalytics(teamId);
      setTeamAnalytics(data);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const loadMemberAnalytics = async (userId: string) => {
    setMemberAnalyticsLoading(true);
    try {
      const data = await api.get(`/api/members/${userId}/analytics?period=7d`);
      setMemberAnalytics(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setMemberAnalyticsLoading(false);
    }
  };

  const canManageMember = (member: Membership) => {
    if (!isAdmin) return false;
    if (member.role === "owner") return false;
    if (user?.role === "admin" && member.role === "admin") return false;
    return true;
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col md:pl-3">
      <div className="flex flex-1 flex-col overflow-hidden bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h1 className="text-base font-semibold text-ink">Teams</h1>
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              onClick={() => setTab("teams")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tab === "teams"
                  ? "bg-ink text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Teams
            </button>
            <button
              onClick={() => setTab("members")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tab === "members"
                  ? "bg-ink text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Members
            </button>
          </div>
        </div>

        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Left panel: list */}
          <div className="flex w-full md:w-72 flex-col border-r border-border">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={
                    tab === "teams" ? "Search teams..." : "Search members..."
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface py-2 pl-6 pr-2 text-sm text-ink outline-none placeholder:text-muted-foreground"
                />
              </div>
              {isAdmin && (
                <button
                  onClick={() =>
                    tab === "teams"
                      ? setShowCreateTeam(true)
                      : setShowInviteMember(true)
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                  title={tab === "teams" ? "Create team" : "Invite member"}
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {tab === "teams" ? (
                filteredTeams.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No teams yet
                  </p>
                ) : (
                  filteredTeams.map((team) => (
                    <button
                      key={team.id}
                      onClick={async () => {
                        const detail = await teamsApi.getTeam(team.id);
                        setSelectedTeam(detail);
                        setTeamTab("members");
                        loadTeamAnalytics(team.id);
                      }}
                      className={`w-full rounded-lg px-4 py-2.5 text-left transition-colors ${
                        selectedTeam?.id === team.id
                          ? "bg-surface-2"
                          : "hover:bg-surface-2"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-ink">
                          {team.name}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {team.member_count}
                          </span>
                        </div>
                      </div>
                      {team.description && (
                        <p className="mt-1 text-xs text-muted-foreground truncate">
                          {team.description}
                        </p>
                      )}
                    </button>
                  ))
                )
              ) : filteredMembers.length === 0 && invitations.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No members yet
                </p>
              ) : (
                <>
                  {filteredMembers.map((member) => {
                    const isMe = user?.email === member.user.email;
                    return (
                    <button
                      key={member.id}
                      onClick={() => { setSelectedMember(member); setMemberTab("details"); }}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-4 py-2.5 transition-colors ${
                        selectedMember?.id === member.id
                          ? "bg-surface-2"
                          : "hover:bg-surface-2"
                      }`}
                    >
                      <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">
                        {member.user.name?.charAt(0) ||
                          member.user.email.charAt(0).toUpperCase()}
                        <span
                          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-card ${
                            member.user.is_online ? "bg-emerald-500" : "bg-muted-foreground/60"
                          }`}
                          title={member.user.is_online ? "Online" : "Offline"}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">
                          {member.user.name || member.user.email}
                          {isMe && (
                            <span className="ml-1.5 inline-flex items-center rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {member.user.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${member.open_conversations > 0 ? "bg-blue-100 text-blue-700" : "bg-surface-2 text-muted-foreground"}`} title={`${member.open_conversations} open / ${member.total_conversations} total`}>
                          {member.open_conversations}/{member.total_conversations}
                        </span>
                        <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          member.role === "owner"
                            ? "bg-purple-100 text-purple-700"
                            : member.role === "admin"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-surface-2 text-muted-foreground"
                        }`}>
                          {member.role === "owner" ? (
                            <Shield className="h-3 w-3" />
                          ) : null}
                          {member.role}
                        </span>
                        {member.status === "invited" && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">
                            <Clock className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </button>
                    );
                  })}
                  {invitations.length > 0 && (
                    <>
                      <div className="mx-4 my-2 border-t border-border" />
                      <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Pending Invitations
                      </p>
                      {invitations.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center gap-2.5 rounded-lg px-4 py-2.5 hover:bg-surface-2"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-xs font-medium text-amber-700">
                            <Mail className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink truncate">
                              {inv.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  try {
                                    await teamsApi.resendInvitation(inv.id);
                                    toast.success("Invitation resent");
                                    loadData();
                                  } catch (e: any) {
                                    toast.error(e.message);
                                  }
                                }}
                                className="rounded p-1 text-muted-foreground hover:text-foreground"
                                title="Resend invitation"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: "Cancel Invitation",
                                    message: `Are you sure you want to cancel the invitation for ${inv.email}?`,
                                    confirmLabel: "Cancel Invitation",
                                    variant: "danger",
                                  });
                                  if (!ok) return;
                                  try {
                                    await teamsApi.cancelInvitation(inv.id);
                                    setInvitations(invitations.filter((i) => i.id !== inv.id));
                                    toast.success("Invitation cancelled");
                                  } catch (e: any) {
                                    toast.error(e.message);
                                  }
                                }}
                                className="rounded p-1 text-muted-foreground hover:text-red-500"
                                title="Cancel invitation"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right panel: detail */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {tab === "teams" && selectedTeam ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Team header */}
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-ink">
                      {selectedTeam.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-ink">{selectedTeam.name}</h2>
                      <p className="text-xs text-muted-foreground">{selectedTeam.description || "No description"}</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEditTeam({ name: selectedTeam.name, description: selectedTeam.description })}
                        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                        title="Edit team"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setShowAddMembers(true)}
                        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Add
                      </button>
                      <button
                        onClick={() => handleDeleteTeam(selectedTeam.id)}
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-red-500"
                        title="Delete team"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Team tabs */}
                <div className="flex border-b border-border px-5">
                  <button
                    onClick={() => setTeamTab("members")}
                    className={`mr-4 border-b-2 py-2.5 text-sm font-medium transition-colors ${
                      teamTab === "members"
                        ? "border-ink text-ink"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Members ({selectedTeam.member_count})
                  </button>
                  <button
                    onClick={() => {
                      setTeamTab("analytics");
                      loadTeamAnalytics(selectedTeam.id);
                    }}
                    className={`border-b-2 py-2.5 text-sm font-medium transition-colors ${
                      teamTab === "analytics"
                        ? "border-ink text-ink"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Analytics
                  </button>
                </div>

                {/* Team tab content */}
                <div className="flex-1 overflow-y-auto p-5">
                  {teamTab === "members" ? (
                    <>
                      {!selectedTeam.members || selectedTeam.members.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
                          <Users className="mb-3 h-10 w-10 text-border" />
                          <p>No members in this team</p>
                          {isAdmin && (
                            <button onClick={() => setShowAddMembers(true)} className="mt-2 text-accent hover:underline">
                              Add members
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                                <th className="pb-2 pr-4">Name</th>
                                <th className="pb-2 pr-4">Role</th>
                                <th className="pb-2 pr-4 text-center">Assigned</th>
                                <th className="pb-2 w-10"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedTeam.members.map((tm) => {
                                const isTeamMe = user?.email === tm.user.email;
                                return (
                                <tr key={tm.id} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
                                  <td className="py-2.5 pr-4">
                                    <div className="flex items-center gap-2.5">
                                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">
                                        {tm.user.name?.charAt(0) || tm.user.email.charAt(0).toUpperCase()}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-ink truncate">
                                          {tm.user.name || tm.user.email}
                                          {isTeamMe && (
                                            <span className="ml-1.5 inline-flex items-center rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">You</span>
                                          )}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">{tm.user.email}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    {isAdmin ? (
                                      <div className="relative">
                                        <button
                                          onClick={() => setTeamMemberRoleTarget(teamMemberRoleTarget?.userId === tm.user.id ? null : { userId: tm.user.id, currentRole: tm.role })}
                                          className={`flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-surface ${
                                            tm.role === "admin" ? "text-blue-600" : "text-muted-foreground"
                                          }`}
                                        >
                                          {tm.role === "admin" ? <Shield className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                                          {tm.role}
                                          <ChevronDown className="h-3 w-3" />
                                        </button>
                                        {teamMemberRoleTarget?.userId === tm.user.id && (
                                          <>
                                            <div className="fixed inset-0 z-10" onClick={() => setTeamMemberRoleTarget(null)} />
                                            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
                                              <button
                                                onClick={() => handleChangeTeamMemberRole(tm.user.id, "admin")}
                                                disabled={actionLoading || tm.role === "admin"}
                                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40"
                                              >
                                                <Shield className="h-3.5 w-3.5 text-blue-500" />
                                                <div>
                                                  <p className="font-medium">Admin</p>
                                                  <p className="text-[10px] text-muted-foreground">Manage team</p>
                                                </div>
                                                {tm.role === "admin" && <Check className="ml-auto h-3.5 w-3.5" />}
                                              </button>
                                              <button
                                                onClick={() => handleChangeTeamMemberRole(tm.user.id, "member")}
                                                disabled={actionLoading || tm.role === "member"}
                                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40"
                                              >
                                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                                <div>
                                                  <p className="font-medium">Member</p>
                                                  <p className="text-[10px] text-muted-foreground">Handle conversations</p>
                                                </div>
                                                {tm.role === "member" && <Check className="ml-auto h-3.5 w-3.5" />}
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    ) : (
                                      <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                                        tm.role === "admin" ? "text-blue-600" : "text-muted-foreground"
                                      }`}>
                                        {tm.role === "admin" ? <Shield className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                                        {tm.role}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pr-4 text-center">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                      tm.open_conversations > 0 ? "bg-blue-50 text-blue-700" : "bg-surface-2 text-muted-foreground"
                                    }`}>
                                      {tm.open_conversations}/{tm.total_conversations}
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    {isAdmin && (
                                      <button
                                        onClick={() => handleRemoveTeamMember(selectedTeam.id, tm.user.id)}
                                        className="rounded p-1 text-muted-foreground hover:text-red-500"
                                        title="Remove from team"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Analytics Tab */
                    <>
                      {!teamAnalytics ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Stats cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                              { label: "Total", value: teamAnalytics.conversations.total, color: "text-ink" },
                              { label: "Open", value: teamAnalytics.conversations.open, color: "text-green-600" },
                              { label: "Pending", value: teamAnalytics.conversations.pending, color: "text-amber-600" },
                              { label: "Closed", value: teamAnalytics.conversations.closed, color: "text-muted-foreground" },
                            ].map((stat) => (
                              <div key={stat.label} className="rounded-lg border border-border bg-surface p-3">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase">{stat.label}</p>
                                <p className={`mt-1 text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
                              </div>
                            ))}
                          </div>

                          <div className="rounded-lg border border-border bg-surface p-3">
                            <p className="text-[11px] font-medium text-muted-foreground uppercase">Messages Sent</p>
                            <p className="mt-1 text-2xl font-semibold text-ink">{teamAnalytics.total_messages}</p>
                          </div>

                          {/* Per-member stats */}
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Member Performance</p>
                            {teamAnalytics.members.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No members</p>
                            ) : (
                              <div className="space-y-2">
                                {teamAnalytics.members.map((m) => (
                                  <div key={m.user.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">
                                      {m.user.name?.charAt(0) || m.user.email.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-ink truncate">{m.user.name}</p>
                                      <p className="text-xs text-muted-foreground">{m.role}</p>
                                    </div>
                                    <div className="flex items-center gap-4 text-center">
                                      <div>
                                        <p className="text-sm font-semibold text-ink">{m.conversations_handled}</p>
                                        <p className="text-[10px] text-muted-foreground">conversations</p>
                                      </div>
                                      <div>
                                        <p className="text-sm font-semibold text-green-600">{m.closed}</p>
                                        <p className="text-[10px] text-muted-foreground">closed</p>
                                      </div>
                                      <div>
                                        <p className="text-sm font-semibold text-ink">{m.messages_sent}</p>
                                        <p className="text-[10px] text-muted-foreground">messages</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Recent conversations */}
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Conversations</p>
                            {teamAnalytics.recent_conversations.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No conversations yet</p>
                            ) : (
                              <div className="space-y-1">
                                {teamAnalytics.recent_conversations.map((c) => (
                                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-ink truncate">{c.customer_name}</p>
                                      <p className="text-xs text-muted-foreground truncate">{c.subject}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {c.assignee && <span className="text-[11px] text-muted-foreground">{c.assignee}</span>}
                                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                        c.status === "open" ? "bg-green-100 text-green-700" :
                                        c.status === "pending" ? "bg-amber-100 text-amber-700" :
                                        "bg-surface-2 text-muted-foreground"
                                      }`}>
                                        {c.status}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : tab === "members" && selectedMember ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-4 border-b border-border px-5 py-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-base font-medium text-accent">
                    {selectedMember.user.name?.charAt(0) ||
                      selectedMember.user.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-semibold text-ink">
                      {selectedMember.user.name || selectedMember.user.email}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedMember.user.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${
                        selectedMember.status === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {selectedMember.status === "active" ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      {selectedMember.status === "active" ? "Active" : "Invited"}
                    </span>
                    {canManageMember(selectedMember) && (
                      <button
                        onClick={() => handleRemoveMember(selectedMember)}
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-red-500"
                        title="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Member tabs */}
                <div className="flex border-b border-border px-5">
                  <button
                    onClick={() => setMemberTab("details")}
                    className={`mr-4 border-b-2 py-2.5 text-sm font-medium transition-colors ${
                      memberTab === "details"
                        ? "border-ink text-ink"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Details
                  </button>
                  <button
                    onClick={() => {
                      setMemberTab("analytics");
                      loadMemberAnalytics(selectedMember.user.id);
                    }}
                    className={`border-b-2 py-2.5 text-sm font-medium transition-colors ${
                      memberTab === "analytics"
                        ? "border-ink text-ink"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Analytics
                  </button>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-5">
                  {memberTab === "details" ? (
                    <>
                      <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-border bg-surface p-4">
                          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                            <Shield className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">Role</span>
                          </div>
                          {canManageMember(selectedMember) ? (
                            <div className="relative">
                              <button
                                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                                className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
                              >
                                <span className="capitalize">{selectedMember.role}</span>
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </button>
                              {showRoleDropdown && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setShowRoleDropdown(false)} />
                                  <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-card p-1 shadow-lg">
                                    <button
                                      onClick={() => handleChangeRole(selectedMember, "admin")}
                                      disabled={actionLoading || selectedMember.role === "admin"}
                                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40 ${
                                        selectedMember.role === "admin" ? "font-medium text-ink" : "text-ink"
                                      }`}
                                    >
                                      <Shield className="h-4 w-4 text-blue-500" />
                                      <div>
                                        <p className="font-medium">Admin</p>
                                        <p className="text-xs text-muted-foreground">Can manage members and teams</p>
                                      </div>
                                      {selectedMember.role === "admin" && <Check className="ml-auto h-4 w-4" />}
                                    </button>
                                    <button
                                      onClick={() => handleChangeRole(selectedMember, "agent")}
                                      disabled={actionLoading || selectedMember.role === "agent"}
                                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40 ${
                                        selectedMember.role === "agent" ? "font-medium text-ink" : "text-ink"
                                      }`}
                                    >
                                      <Users className="h-4 w-4 text-muted-foreground" />
                                      <div>
                                        <p className="font-medium">Agent</p>
                                        <p className="text-xs text-muted-foreground">Can handle conversations</p>
                                      </div>
                                      {selectedMember.role === "agent" && <Check className="ml-auto h-4 w-4" />}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-ink capitalize">
                              {selectedMember.role}
                            </p>
                          )}
                        </div>
                        <div className="rounded-lg border border-border bg-surface p-4">
                          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                            <Users className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">Teams</span>
                          </div>
                          <p className="text-sm font-medium text-ink">
                            {selectedTeam?.members?.filter((tm) => tm.user.id === selectedMember.user.id).length || 0}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Details
                        </p>
                        <div className="rounded-lg border border-border divide-y divide-border">
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Joined</span>
                            <span className="text-sm text-ink">
                              {new Date(selectedMember.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {selectedMember.invited_by && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <span className="text-sm text-muted-foreground">Invited by</span>
                              <span className="text-sm text-ink">
                                {selectedMember.invited_by.name || selectedMember.invited_by.email}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Analytics tab */
                    <>
                      {memberAnalyticsLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : !memberAnalytics ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <BarChart3 className="mb-3 h-10 w-10 text-border" />
                          <p className="text-sm text-muted-foreground">No analytics data</p>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {/* Stat cards */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">Conversations</p>
                              <p className="mt-1 text-2xl font-bold text-ink">{memberAnalytics.conversations.total}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {memberAnalytics.conversations.resolved} resolved
                              </p>
                            </div>
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">Messages Sent</p>
                              <p className="mt-1 text-2xl font-bold text-ink">{memberAnalytics.messages.sent}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {memberAnalytics.messages.human_replies} human / {memberAnalytics.messages.ai_replies} AI
                              </p>
                            </div>
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">Avg First Response</p>
                              <p className="mt-1 text-2xl font-bold text-ink">
                                {memberAnalytics.response_times.avg_first_response_minutes !== null
                                  ? `${memberAnalytics.response_times.avg_first_response_minutes}m`
                                  : "N/A"}
                              </p>
                            </div>
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">Avg Resolution</p>
                              <p className="mt-1 text-2xl font-bold text-ink">
                                {memberAnalytics.response_times.avg_resolution_minutes !== null
                                  ? `${memberAnalytics.response_times.avg_resolution_minutes}m`
                                  : "N/A"}
                              </p>
                            </div>
                          </div>

                          {/* SLA + Escalation */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">SLA Compliance</p>
                              <p className="mt-1 text-2xl font-bold text-ink">
                                {memberAnalytics.sla.compliance_rate !== null
                                  ? `${memberAnalytics.sla.compliance_rate}%`
                                  : "N/A"}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {memberAnalytics.sla.breached} breached / {memberAnalytics.sla.total} total
                              </p>
                            </div>
                            <div className="rounded-lg border border-border p-4">
                              <p className="text-xs text-muted-foreground">Escalation Rate</p>
                              <p className="mt-1 text-2xl font-bold text-ink">
                                {memberAnalytics.escalation_rate !== null
                                  ? `${memberAnalytics.escalation_rate}%`
                                  : "N/A"}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : tab === "teams" ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <Users className="mx-auto mb-3 h-12 w-12 text-border" />
                  <p className="text-sm text-muted-foreground">
                    Select a team to view details
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <Users className="mx-auto mb-3 h-12 w-12 text-border" />
                  <p className="text-sm text-muted-foreground">
                    Select a member to view their profile
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Team Modal */}
      {showCreateTeam && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowCreateTeam(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-lg">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">Create Team</h3>
              <button onClick={() => setShowCreateTeam(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-4 mb-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg font-bold text-ink border border-border">
                {newTeam.name.trim()
                  ? newTeam.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
                  : "?"}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">
                  {newTeam.name.trim() || "Team Name"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {newTeam.description.trim() || "Add a description"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Team Name *</label>
                <input
                  type="text"
                  value={newTeam.name}
                  onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
                  placeholder="e.g. Support, Engineering, Sales"
                  maxLength={100}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted-foreground focus:border-ink/30"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
                  autoFocus
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {newTeam.name.length}/100
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  value={newTeam.description}
                  onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })}
                  placeholder="What does this team do? (optional)"
                  rows={3}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted-foreground focus:border-ink/30 resize-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button onClick={() => setShowCreateTeam(false)} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleCreateTeam}
                disabled={!newTeam.name.trim()}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Create Team
              </button>
            </div>
          </div>
        </>
      )}

      {/* Invite Member Modal */}
      {showInviteMember && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowInviteMember(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-96 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-lg">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">Invite Member</h3>
              <button onClick={() => setShowInviteMember(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => e.key === "Enter" && handleInviteMember()}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "agent")}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="agent">Agent — Can handle conversations</option>
                  {isOwner && <option value="admin">Admin — Can manage members and teams</option>}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button onClick={() => setShowInviteMember(false)} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleInviteMember}
                disabled={!inviteEmail.includes("@") || actionLoading}
                className="rounded-md bg-ink px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Invite"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add Members to Team Modal */}
      {showAddMembers && selectedTeam && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowAddMembers(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-lg">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">Add Members to {selectedTeam.name}</h3>
              <button onClick={() => setShowAddMembers(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="text-xs font-medium text-muted-foreground">Team Role</label>
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={() => setAddMemberRole("member")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    addMemberRole === "member"
                      ? "border-ink bg-ink text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-2"
                  }`}
                >
                  <Users className="mr-1.5 inline h-3.5 w-3.5" />
                  Member
                </button>
                <button
                  onClick={() => setAddMemberRole("admin")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    addMemberRole === "admin"
                      ? "border-ink bg-ink text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-2"
                  }`}
                >
                  <Shield className="mr-1.5 inline h-3.5 w-3.5" />
                  Admin
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {addMemberRole === "admin"
                  ? "Admins can manage team settings and members"
                  : "Members can handle conversations"}
              </p>
            </div>

            <p className="mb-2 text-xs font-medium text-muted-foreground">Select members</p>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {members.filter(
                (m) =>
                  m.status === "active" &&
                  !selectedTeam.members?.some((tm) => tm.user.id === m.user.id)
              ).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  All active members are already in this team.{" "}
                  <button onClick={() => { setShowAddMembers(false); setShowInviteMember(true); }} className="text-accent hover:underline">
                    Invite more
                  </button>
                </p>
              ) : (
                <>
                  {members
                    .filter(
                      (m) =>
                        m.status === "active" &&
                        !selectedTeam.members?.some((tm) => tm.user.id === m.user.id)
                    )
                    .map((member) => (
                      <label key={member.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.user.id)}
                          onChange={() =>
                            setSelectedMemberIds((prev) =>
                              prev.includes(member.user.id)
                                ? prev.filter((id) => id !== member.user.id)
                                : [...prev, member.user.id]
                            )
                          }
                          className="h-4 w-4 rounded border-border text-accent"
                        />
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-[11px] font-medium text-accent">
                          {member.user.name?.charAt(0) || member.user.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink truncate">{member.user.name || member.user.email}</p>
                          <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
                        </div>
                        <span className={`text-[11px] capitalize ${
                          member.role === "owner" ? "text-purple-600" : member.role === "admin" ? "text-blue-600" : "text-muted-foreground"
                        }`}>
                          {member.role}
                        </span>
                      </label>
                    ))}
                </>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2.5 border-t border-border pt-4">
              <button onClick={() => setShowAddMembers(false)} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleAddMembersToTeam}
                disabled={selectedMemberIds.length === 0}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Add {selectedMemberIds.length > 0 ? `(${selectedMemberIds.length})` : ""}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
