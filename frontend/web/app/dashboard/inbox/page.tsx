"use client";

import { Search, Send, Phone, Mail, MoreHorizontal, Loader2, ChevronDown, ChevronRight, UserCheck, StickyNote, Paperclip, Sparkles, Smile, Bot, MessageSquare, FileText, Globe, Clock, Monitor, Tag, Languages, Archive, Star, Trash2, UserPlus, Hash, Copy, ArrowRight, RefreshCcw } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import {
  fetchConversations,
  fetchConversation,
  fetchPastConversations,
  sendMessage,
  updateConversation,
  deleteConversation,
  assignConversation,
  fetchAgents,
  fetchTeamsList,
  type Conversation,
  type ConversationDetail,
  type Message,
  type Agent,
  type Team,
} from "@/lib/conversations-service";
import { SLABadge } from "@/components/sla-badge";
import {
  suggestReply,
  generateReplyOptions,
  summarizeConversation,
  getNextSteps,
} from "@/lib/ai-service";

type FilterKey = "all" | "assigned" | "unassigned" | "closed";

export default function InboxPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeConvo, setActiveConvo] = useState<ConversationDetail | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState("");
  const [msgType, setMsgType] = useState<"reply" | "note">("reply");
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translateToast, setTranslateToast] = useState<{ show: boolean; lang: string }>({ show: false, lang: "" });
  const [showOriginals, setShowOriginals] = useState<Set<string>>(new Set());
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [assignSubOpen, setAssignSubOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [detailTab, setDetailTab] = useState<"details" | "copilot">("details");
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotMessages, setCopilotMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const copilotEndRef = useRef<HTMLDivElement>(null);
  const [aiReplyOptions, setAiReplyOptions] = useState<string[]>([]);
  const [aiReplyLanguage, setAiReplyLanguage] = useState<string>("en");
  const [aiReplyLoading, setAiReplyLoading] = useState(false);
  const [aiReplyError, setAiReplyError] = useState("");
  const [aiReplySelected, setAiReplySelected] = useState<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) { setMoreOpen(false); setAssignSubOpen(false); }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadConversations();
    fetchAgents().then(setAgents).catch(() => {});
    fetchTeamsList().then(setTeams).catch(() => {});
  }, [filter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    copilotEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [copilotMessages]);

  // Auto-refresh polling for conversations
  useEffect(() => {
    const pollConversations = async () => {
      try {
        const params: Record<string, string> = {};
        if (filter === "assigned") params.assignee = "me";
        else if (filter === "unassigned") params.assignee = "unassigned";
        else if (filter === "closed") params.status = "closed";
        const res = await fetchConversations(params);
        setConversations((prev) => {
          const prevIds = prev.map((c) => c.id).join(",");
          const newIds = res.results.map((c: any) => c.id).join(",");
          if (prevIds !== newIds) return res.results;
          return prev.map((c) => {
            const updated = res.results.find((r: any) => r.id === c.id);
            return updated ? { ...c, ...updated } : c;
          });
        });
      } catch {}
    };
    const interval = setInterval(pollConversations, 5000);
    return () => clearInterval(interval);
  }, [filter]);

  // Auto-refresh polling for active conversation messages
  useEffect(() => {
    if (!activeId) return;
    const pollMessages = async () => {
      try {
        const detail = await fetchConversation(activeId);
        setMessages((prev) => {
          const prevIds = prev.map((m) => m.id).join(",");
          const newIds = (detail.messages || []).map((m: any) => m.id).join(",");
          if (prevIds !== newIds) return detail.messages || [];
          return prev;
        });
        setActiveConvo((prev) => (prev ? { ...prev, ...detail } : prev));
      } catch {}
    };
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [activeId]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filter === "assigned") params.assignee = "me";
      else if (filter === "unassigned") params.assignee = "unassigned";
      else if (filter === "closed") params.status = "closed";
      // "all" — no status filter, show everything
      const res = await fetchConversations(params);
      setConversations(res.results);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const selectConversation = async (id: string) => {
    setActiveId(id);
    setLoadingDetail(true);
    try {
      const detail = await fetchConversation(id);
      setActiveConvo(detail);
      setMessages(detail.messages || []);

      // Auto-translate: read setting from localStorage
      const autoTranslatePref = typeof window !== "undefined" ? localStorage.getItem("auto_translate") : null;
      if (autoTranslatePref !== "off") {
        // Check if any customer message has a detected language that isn't English
        const hasTranslation = detail.messages?.some(
          (m: any) => m.is_from_customer && m.detected_language && m.detected_language !== "en"
        );
        if (hasTranslation) {
          const langMsg = [...(detail.messages || [])].reverse().find(
            (m: any) => m.is_from_customer && m.detected_language && m.detected_language !== "en"
          );
          const langCode = langMsg?.detected_language?.toUpperCase() || "??";
          setAutoTranslate(true);
          setTranslateToast({ show: true, lang: `Auto-translating: ${langCode} → EN` });
          setTimeout(() => setTranslateToast((t) => ({ ...t, show: false })), 3000);
        }
      } else {
        setAutoTranslate(false);
      }
    } catch {
      setActiveConvo(null);
      setMessages([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSend = async () => {
    if (!replyText.trim() || !activeId || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(activeId, replyText.trim(), msgType);
      setMessages((prev) => [...prev, msg]);
      setReplyText("");
      loadConversations();
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAssign = async (assigneeId?: string) => {
    if (!activeId) return;
    try {
      const updated = await assignConversation(activeId, assigneeId, activeConvo?.team?.id || undefined);
      setActiveConvo(updated);
      loadConversations();
      toast.success("Conversation assigned");
    } catch {
      toast.error("Failed to assign conversation");
    }
  };

  const handleTeamChange = async (teamId?: string) => {
    if (!activeId) return;
    try {
      const updated = await assignConversation(activeId, undefined, teamId || undefined);
      setActiveConvo(updated);
      loadConversations();
      toast.success("Team updated");
    } catch {
      toast.error("Failed to update team");
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!activeId) return;
    try {
      const updated = await updateConversation(activeId, { status });
      setActiveConvo(updated);
      loadConversations();
      toast.success(`Status changed to ${status}`);
    } catch {
      toast.error("Failed to change status");
    }
  };

  const handlePriorityChange = async (priority: string) => {
    if (!activeId) return;
    try {
      const updated = await updateConversation(activeId, { priority });
      setActiveConvo(updated);
      loadConversations();
      toast.success(`Priority changed to ${priority}`);
    } catch {
      toast.error("Failed to change priority");
    }
  };

  const handleDelete = async () => {
    if (!activeId) return;
    const ok = await confirm({
      title: "Delete conversation",
      message: "Are you sure you want to delete this conversation? This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteConversation(activeId);
      setActiveId(null);
      setActiveConvo(null);
      setMessages([]);
      setMoreOpen(false);
      loadConversations();
      toast.success("Conversation deleted");
    } catch {
      toast.error("Failed to delete conversation");
    }
  };

  const handleCopilotSend = async (text?: string) => {
    const msg = (text || copilotInput).trim();
    if (!msg || copilotLoading || !activeId) return;
    setCopilotMessages((prev) => [...prev, { role: "user", text: msg }]);
    setCopilotInput("");
    setCopilotLoading(true);

    try {
      const lowerMsg = msg.toLowerCase();
      if (lowerMsg === "summarize" || lowerMsg.startsWith("summarize")) {
        const res = await summarizeConversation(activeId);
        setCopilotMessages((prev) => [...prev, { role: "assistant", text: res.summary }]);
      } else if (lowerMsg === "next steps" || lowerMsg.startsWith("next step")) {
        const res = await getNextSteps(activeId);
        const steps = res.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
        setCopilotMessages((prev) => [...prev, { role: "assistant", text: `**Suggested Next Steps:**\n\n${steps}` }]);
      } else if (lowerMsg === "suggest" || lowerMsg.startsWith("suggest reply")) {
        const res = await suggestReply(activeId);
        const formatted = res.suggestions.map((s, i) => `**Option ${i + 1}:**\n${s}`).join("\n\n---\n\n");
        setCopilotMessages((prev) => [...prev, { role: "assistant", text: `**Suggested Replies:**\n\n${formatted}` }]);
      } else {
        // Default: try summarize + next steps for generic questions
        const [summaryRes, stepsRes] = await Promise.allSettled([
          summarizeConversation(activeId),
          getNextSteps(activeId),
        ]);
        let reply = "I can help you with this conversation. Try:\n- **\"summarize\"** — Get a summary\n- **\"next steps\"** — Suggested actions\n- **\"suggest\"** — 3 reply suggestions";
        if (summaryRes.status === "fulfilled" && stepsRes.status === "fulfilled") {
          const steps = stepsRes.value.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
          reply = `**Summary:**\n${summaryRes.value.summary}\n\n**Next Steps:**\n${steps}`;
        } else if (summaryRes.status === "fulfilled") {
          reply = `**Summary:**\n${summaryRes.value.summary}`;
        } else if (stepsRes.status === "fulfilled") {
          const steps = stepsRes.value.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
          reply = `**Next Steps:**\n${steps}`;
        }
        setCopilotMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      }
    } catch (err) {
      setCopilotMessages((prev) => [...prev, { role: "assistant", text: "AI is not configured or unavailable. Please set up your API key in the AI settings." }]);
    } finally {
      setCopilotLoading(false);
    }
  };

  const loadAiReplyOptions = async (selectedId: string | null = null) => {
    const convId = selectedId || activeId;
    if (!convId || aiReplyLoading) return;
    setAiReplyLoading(true);
    setAiReplyError("");
    setAiReplySelected(null);
    try {
      const res = await generateReplyOptions(convId);
      setAiReplyOptions(res.options);
      setAiReplyLanguage(res.language);
    } catch {
      setAiReplyOptions([]);
      setAiReplyError("AI couldn't generate a reply. Please try again.");
    } finally {
      setAiReplyLoading(false);
    }
  };

  const useAiReplyOption = (text: string) => {
    setReplyText(text);
    setAiReplyOptions([]);
    setAiReplySelected(null);
  };

  const copilotSuggestions = [
    { label: "Summarize", key: "summarize" },
    { label: "Next steps", key: "next steps" },
    { label: "Suggest reply", key: "suggest" },
  ];

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?";

  const channelIcons: Record<string, React.ReactNode> = {
    widget: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <rect x="1" y="2" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M5 14h6l-1.5-2H6.5L5 14z" fill="currentColor" />
      </svg>
    ),
    email: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M1 5l7 4.5L15 5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    ),
    whatsapp: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <path d="M8 1a7 7 0 00-6.3 10.3L1 15l3.8-1A7 7 0 108 1z" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M5.5 5.5c0 0 .5 1 1.5 2s2 1.5 2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M5 5.5c0 0 .5 2 2 3.5s3.5 2 3.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    api: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <path d="M10 4l4 4-4 4M6 12l-4-4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  };

  const channelColors: Record<string, string> = {
    widget: "bg-emerald-500",
    email: "bg-blue-500",
    whatsapp: "bg-green-600",
    api: "bg-purple-500",
  };

  const isLive = (c: Conversation) => {
    if (c.status !== "open") return false;
    if (!c.last_message?.created_at) return false;
    const diff = Date.now() - new Date(c.last_message.created_at).getTime();
    return diff < 180000;
  };

  const customerLang = (() => {
    // First, try to get language from the last customer message's detected_language
    if (messages.length > 0) {
      const lastCustomerMsg = [...messages].reverse().find((m) => m.is_from_customer && m.detected_language);
      if (lastCustomerMsg?.detected_language && lastCustomerMsg.detected_language !== "en") {
        const langMap: Record<string, { code: string; name: string }> = {
          ar: { code: "ar", name: "Arabic" }, az: { code: "az", name: "Azerbaijani" },
          bn: { code: "bn", name: "Bengali" }, bg: { code: "bg", name: "Bulgarian" },
          ca: { code: "ca", name: "Catalan" }, zh: { code: "zh", name: "Chinese" },
          "zh-Hans": { code: "zh-Hans", name: "Chinese (Simplified)" },
          "zh-Hant": { code: "zh-Hant", name: "Chinese (Traditional)" },
          cs: { code: "cs", name: "Czech" }, da: { code: "da", name: "Danish" },
          nl: { code: "nl", name: "Dutch" }, eo: { code: "eo", name: "Esperanto" },
          et: { code: "et", name: "Estonian" }, fi: { code: "fi", name: "Finnish" },
          fr: { code: "fr", name: "French" }, de: { code: "de", name: "German" },
          el: { code: "el", name: "Greek" }, he: { code: "he", name: "Hebrew" },
          hi: { code: "hi", name: "Hindi" }, hu: { code: "hu", name: "Hungarian" },
          id: { code: "id", name: "Indonesian" }, ga: { code: "ga", name: "Irish" },
          it: { code: "it", name: "Italian" }, ja: { code: "ja", name: "Japanese" },
          ko: { code: "ko", name: "Korean" }, ky: { code: "ky", name: "Kyrgyz" },
          lv: { code: "lv", name: "Latvian" }, lt: { code: "lt", name: "Lithuanian" },
          ms: { code: "ms", name: "Malay" }, nb: { code: "nb", name: "Norwegian" },
          fa: { code: "fa", name: "Persian" }, pl: { code: "pl", name: "Polish" },
          pt: { code: "pt", name: "Portuguese" }, ro: { code: "ro", name: "Romanian" },
          ru: { code: "ru", name: "Russian" }, sk: { code: "sk", name: "Slovak" },
          sl: { code: "sl", name: "Slovenian" }, es: { code: "es", name: "Spanish" },
          sw: { code: "sw", name: "Swahili" }, sv: { code: "sv", name: "Swedish" },
          tl: { code: "tl", name: "Tagalog" }, th: { code: "th", name: "Thai" },
          tr: { code: "tr", name: "Turkish" }, uk: { code: "uk", name: "Ukrainian" },
          ur: { code: "ur", name: "Urdu" }, vi: { code: "vi", name: "Vietnamese" },
        };
        return langMap[lastCustomerMsg.detected_language] || { code: lastCustomerMsg.detected_language, name: lastCustomerMsg.detected_language };
      }
    }
    // Fallback to location-based detection
    if (!activeConvo?.location) return null;
    const loc = activeConvo.location.toLowerCase();
    if (loc.includes("germany") || loc.includes("hamburg") || loc.includes("berlin")) return { code: "de", name: "German" };
    if (loc.includes("france") || loc.includes("paris")) return { code: "fr", name: "French" };
    if (loc.includes("spain") || loc.includes("madrid") || loc.includes("barcelona")) return { code: "es", name: "Spanish" };
    if (loc.includes("italy") || loc.includes("rome") || loc.includes("milan")) return { code: "it", name: "Italian" };
    if (loc.includes("netherlands") || loc.includes("amsterdam")) return { code: "nl", name: "Dutch" };
    if (loc.includes("japan") || loc.includes("tokyo")) return { code: "ja", name: "Japanese" };
    if (loc.includes("china") || loc.includes("beijing") || loc.includes("shanghai")) return { code: "zh", name: "Chinese" };
    return null;
  })();

  const filterOptions: { key: FilterKey; label: string }[] = [
    { key: "all", label: "Open" },
    { key: "assigned", label: "Mine" },
    { key: "unassigned", label: "Unassigned" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div className="flex h-full flex-col md:pl-3">
      {/* Auto-translate toast */}
      <div
        className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 transition-all duration-300 ease-out ${
          translateToast.show ? "translate-y-0 opacity-100" : "-translate-y-16 opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-white px-4 py-2 shadow-lg">
          <Languages className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-ink">
            <span className="text-accent font-semibold">{translateToast.lang}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden bg-card shadow-sm">
        {/* Left sidebar — conversation list */}
        <div className="flex w-full md:w-80 shrink-0 flex-col border-r border-border">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
            {filterOptions.map((f) => (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setActiveId(null); setActiveConvo(null); }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-ink text-primary-foreground"
                    : "text-muted-foreground hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative border-b border-border px-3 py-2.5">
            <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-2 text-sm text-ink outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">No conversations</p>
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-surface-2 ${
                    activeId === c.id ? "bg-surface ring-1 ring-inset ring-accent/25" : ""
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                      {getInitials(c.customer_name || c.customer_email)}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-card text-white ${channelColors[c.channel] || "bg-surface-2"}`}>
                      {channelIcons[c.channel] || channelIcons.widget}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {c.customer_name || c.customer_email || `Visitor #${c.ticket_id}`}
                      </span>
                      {isLive(c) ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-green-600">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                          </span>
                          Live
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.last_message?.body || c.subject || "No messages yet"}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        c.status === "open" ? "bg-green-100 text-green-700" :
                        c.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                        "bg-surface-2 text-muted-foreground"
                      }`}>
                        {c.status}
                      </span>
                      {c.sla_status && c.sla_status !== "none" && (
                        <SLABadge
                          status={c.sla_status}
                          timeRemaining={c.sla_time_remaining}
                          deadline={c.sla_deadline}
                          compact
                        />
                      )}
                      {c.assignee && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {c.assignee.name}
                        </span>
                      )}
                      {c.team && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          {c.team.name}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {c.last_message ? formatTime(c.last_message.created_at) : ""}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Center — chat panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {loadingDetail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !activeConvo ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a conversation</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                    {getInitials(activeConvo.customer_name || activeConvo.customer_email)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">
                        {activeConvo.customer_name || activeConvo.customer_email || `Visitor #${activeConvo.ticket_id}`}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">via {activeConvo.channel}</span>
                    </div>
                    {activeConvo.customer_email && (
                      <span className="text-xs text-muted-foreground">{activeConvo.customer_email}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Status dropdown */}
                  <div className="relative" ref={statusRef}>
                    <button
                      onClick={() => setStatusOpen(!statusOpen)}
                      className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                        activeConvo.status === "open" ? "bg-green-500" :
                        activeConvo.status === "pending" ? "bg-yellow-500" : "bg-surface-2"
                      }`} />
                      {activeConvo.status.charAt(0).toUpperCase() + activeConvo.status.slice(1)}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {statusOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-lg border border-border bg-card py-1 shadow-lg">
                        {["open", "pending", "closed"].map((s) => (
                          <button
                            key={s}
                            onClick={() => { handleStatusChange(s); setStatusOpen(false); }}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                              activeConvo.status === s ? "bg-surface-2 font-medium text-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                            }`}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                              s === "open" ? "bg-green-500" :
                              s === "pending" ? "bg-yellow-500" : "bg-surface-2"
                            }`} />
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Priority dropdown */}
                  <div className="relative" ref={priorityRef}>
                    <button
                      onClick={() => setPriorityOpen(!priorityOpen)}
                      className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                        activeConvo.priority === "urgent" ? "bg-red-500" :
                        activeConvo.priority === "high" ? "bg-orange-500" :
                        activeConvo.priority === "normal" ? "bg-blue-500" : "bg-surface-2"
                      }`} />
                      {activeConvo.priority === "urgent" ? "Urgent" : activeConvo.priority.charAt(0).toUpperCase() + activeConvo.priority.slice(1)}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {priorityOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-lg border border-border bg-card py-1 shadow-lg">
                        {["urgent", "high", "normal", "low"].map((p) => (
                          <button
                            key={p}
                            onClick={() => { handlePriorityChange(p); setPriorityOpen(false); }}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                              activeConvo.priority === p ? "bg-surface-2 font-medium text-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                            }`}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                              p === "urgent" ? "bg-red-500" :
                              p === "high" ? "bg-orange-500" :
                              p === "normal" ? "bg-blue-500" : "bg-surface-2"
                            }`} />
                            {p === "urgent" ? "Urgent" : p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mx-1.5 h-5 w-px bg-border" />

                  {/* Call, Email, More actions */}
                  <div className="flex items-center gap-0.5">
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors" title="Call">
                      <Phone className="h-3.5 w-3.5" />
                    </button>
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors" title="Email">
                      <Mail className="h-3.5 w-3.5" />
                    </button>
                    {/* More menu */}
                    <div className="relative" ref={moreRef}>
                      <button
                        onClick={() => { setMoreOpen(!moreOpen); setAssignSubOpen(false); }}
                        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                          moreOpen ? "bg-surface-2 text-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                        }`}
                        title="More"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                      {moreOpen && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
                          {/* Assign */}
                          <div className="relative">
                            <button
                              onClick={() => setAssignSubOpen(!assignSubOpen)}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors"
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                              Assign
                              <ChevronRight className="ml-auto h-3 w-3" />
                            </button>
                            {assignSubOpen && (
                              <div className="absolute left-full top-0 ml-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
                                <button
                                  onClick={() => { handleAssign(undefined); setMoreOpen(false); setAssignSubOpen(false); }}
                                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                                    !activeConvo?.assignee ? "bg-surface-2 font-medium text-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                                  }`}
                                >
                                  <UserCheck className="h-3.5 w-3.5" />
                                  Myself
                                </button>
                                <div className="mx-2 my-1 border-t border-border" />
                                {agents.map((a) => (
                                  <button
                                    key={a.id}
                                    onClick={() => { handleAssign(a.id); setMoreOpen(false); setAssignSubOpen(false); }}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                                      activeConvo?.assignee?.id === a.id ? "bg-surface-2 font-medium text-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                                    }`}
                                  >
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[7px] font-medium text-accent-foreground">
                                      {(a.name || a.email).charAt(0).toUpperCase()}
                                    </div>
                                    {a.name || a.email}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="mx-2 my-1 border-t border-border" />

                          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors">
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </button>
                          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors">
                            <Star className="h-3.5 w-3.5" />
                            Star
                          </button>
                          <div className="mx-2 my-1 border-t border-border" />
                          <button onClick={handleDelete} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mx-1.5 h-5 w-px bg-border" />

                  {/* Auto-translate toggle */}
                  <button
                    onClick={() => {
                      const next = !autoTranslate;
                      setAutoTranslate(next);
                      if (next) {
                        const langCode = customerLang?.code?.toUpperCase() || "??";
                        setTranslateToast({ show: true, lang: `Translating: ${langCode} → EN` });
                        setTimeout(() => setTranslateToast((t) => ({ ...t, show: false })), 3000);
                      }
                    }}
                    className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
                      autoTranslate
                        ? "bg-accent/15 text-accent"
                        : "text-muted-foreground hover:bg-surface-2 hover:text-ink"
                    }`}
                    title={autoTranslate ? "Showing English (click to show customer language)" : "Showing customer language (click to show English)"}
                  >
                    <Languages className="h-3.5 w-3.5" />
                    {customerLang && (
                      <span className="text-[10px] uppercase font-semibold">
                        {autoTranslate ? "EN" : customerLang.code}
                      </span>
                    )}
                    {autoTranslate && customerLang && (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 whitespace-nowrap">
                        EN↔{customerLang.code.toUpperCase()}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-12">No messages yet</p>
                ) : (
                  <>
                    {activeConvo && (
                      <div className="relative flex items-center py-2">
                        <div className="flex-1 border-t border-border" />
                        <span className="mx-3 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                          Start {new Date(activeConvo.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                        </span>
                        <div className="flex-1 border-t border-border" />
                      </div>
                    )}
                    {messages.reduce<{ msg: typeof messages[number]; first: boolean; last: boolean; isFinal: boolean }[]>((acc, msg, i) => {
                      const prev = messages[i - 1];
                      const next = messages[i + 1];
                      const samePrev = prev && prev.is_from_customer === msg.is_from_customer && (!prev.sender_name || prev.sender_name === msg.sender_name);
                      const sameNext = next && next.is_from_customer === msg.is_from_customer && (!next.sender_name || next.sender_name === msg.sender_name);
                      acc.push({ msg, first: !samePrev, last: !sameNext, isFinal: i === messages.length - 1 });
                      return acc;
                    }, []).map(({ msg, first, last, isFinal }) => (
                      <div key={msg.id} className={`flex items-end gap-2 ${msg.is_from_customer ? "" : "justify-end"} ${first ? "mt-4" : "mt-0.5"}`}>
                        {/* Customer avatar — only on last message of group */}
                        {msg.is_from_customer ? (
                          <div className={`shrink-0 ${last ? "" : "invisible"}`}>
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[9px] font-medium text-accent-foreground">
                              {getInitials(activeConvo?.customer_name || activeConvo?.customer_email || "?")}
                            </div>
                          </div>
                        ) : <div className="w-7" />}

                        <div className={`max-w-[70%] flex flex-col ${msg.is_from_customer ? "" : "items-end"}`}>
                          {/* Sender name — only on first message of agent group */}
                          {!msg.is_from_customer && first && msg.sender_name && (
                            <p className="text-[10px] font-medium text-muted-foreground mb-1 ml-1">{msg.sender_name}</p>
                          )}
                          <div
                            className={`w-fit px-3.5 py-2 ${
                              msg.is_from_customer
                                ? "bg-surface text-ink"
                                : msg.type === "note"
                                ? "bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md"
                                : "bg-card text-ink border border-border shadow-sm"
                            } ${
                              msg.is_from_customer
                                ? first && last ? "rounded-2xl" : first ? "rounded-t-2xl rounded-br-2xl rounded-bl-md" : last ? "rounded-b-2xl rounded-tr-2xl rounded-tl-md" : "rounded-r-2xl rounded-bl-md rounded-tl-md"
                                : msg.type !== "note" && (first && last ? "rounded-2xl" : first ? "rounded-t-2xl rounded-bl-2xl rounded-br-md" : last ? "rounded-b-2xl rounded-tr-md rounded-tl-2xl" : "rounded-l-2xl rounded-br-md rounded-tr-md")
                            }`}
                          >
                            {(() => {
                              const isTranslated = !!(msg.original_body && msg.detected_language);
                              const flipped = showOriginals.has(msg.id);

                              let displayBody: string;
                              if (!isTranslated) {
                                displayBody = msg.body;
                              } else {
                                // Inbound: body=English, original_body=Customer lang
                                // Outbound: body=Customer lang, original_body=English
                                // ON = show English, OFF = show customer language
                                const showEnglish = flipped ? !autoTranslate : autoTranslate;
                                if (msg.is_from_customer) {
                                  displayBody = showEnglish ? msg.body : msg.original_body;
                                } else {
                                  displayBody = showEnglish ? msg.original_body : msg.body;
                                }
                              }

                              return (
                                <>
                                  <p className="text-sm whitespace-pre-wrap">{displayBody}</p>
                                </>
                              );
                            })()}
                            <div className="flex items-center justify-end gap-1 mt-1">
                              {msg.is_from_customer && msg.read_at && isFinal && (
                                <span className="text-[9px] font-medium text-accent">Seen</span>
                              )}
                              <p className={`text-[10px] ${msg.is_from_customer ? "text-muted-foreground" : "opacity-50"}`}>
                                {formatTime(msg.created_at)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Agent avatar — only on last message of group */}
                        {!msg.is_from_customer ? (
                          <div className={`shrink-0 ${last ? "" : "invisible"}`}>
                            {msg.sender_name === "Kai" ? (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white border border-neutral-200 overflow-hidden">
                                <img src="/KAI_Logo.png" alt="Kai" className="h-5 w-5 object-contain" />
                              </div>
                            ) : (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/10 text-[9px] font-medium text-muted-foreground">
                                {msg.sender_name ? getInitials(msg.sender_name) : "A"}
                              </div>
                            )}
                          </div>
                        ) : <div className="w-7" />}
                      </div>
                    ))}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="border-t border-border px-3 py-2.5">
                {/* AI Reply options */}
                {aiReplyLoading ? (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    <span className="text-xs text-muted-foreground">
                      Kai is drafting two replies...
                    </span>
                  </div>
                ) : aiReplyError ? (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                    <span className="text-xs text-red-600">{aiReplyError}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => loadAiReplyOptions()}
                        className="text-[10px] font-medium text-red-600 hover:underline"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => { setAiReplyError(""); setAiReplyOptions([]); }}
                        className="text-[10px] text-muted-foreground hover:text-ink"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : aiReplyOptions.length > 0 ? (
                  <div className="mb-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[10px] font-medium text-accent">
                        <Sparkles className="h-3 w-3" />
                        Kai&apos;s drafts
                        {aiReplyLanguage && aiReplyLanguage !== "en" && (
                          <span className="rounded bg-accent/10 px-1 py-px font-mono uppercase tracking-wider">
                            {aiReplyLanguage}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => loadAiReplyOptions()}
                          disabled={aiReplyLoading}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                        >
                          <RefreshCcw className="h-3 w-3" />
                          Regenerate
                        </button>
                        <button
                          onClick={() => { setAiReplyOptions([]); setAiReplySelected(null); }}
                          className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-ink"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                      {aiReplyOptions.map((text, i) => (
                        <div
                          key={i}
                          className={`group flex flex-col rounded-lg border p-2.5 transition-colors ${
                            aiReplySelected === i
                              ? "border-accent/50 bg-accent/10"
                              : "border-accent/20 bg-accent/5 hover:border-accent/40"
                          }`}
                        >
                          <p className="flex-1 text-xs text-ink leading-relaxed whitespace-pre-wrap line-clamp-4">
                            {text}
                          </p>
                          <div className="mt-2 flex justify-end gap-1">
                            {aiReplySelected === i ? (
                              <>
                                <button
                                  onClick={() => setAiReplySelected(null)}
                                  className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-surface-2"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => useAiReplyOption(text)}
                                  className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-accent-foreground hover:opacity-90"
                                >
                                  Use & edit
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setAiReplySelected(i)}
                                className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-ink hover:text-ink"
                              >
                                Select
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Mode toggle + action buttons */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
                    <button
                      onClick={() => setMsgType("reply")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        msgType === "reply" ? "bg-ink text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-ink"
                      }`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Reply
                    </button>
                    <button
                      onClick={() => setMsgType("note")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        msgType === "note" ? "bg-ink text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-ink"
                      }`}
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                      Note
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors" title="Attach file">
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => loadAiReplyOptions()}
                      disabled={aiReplyLoading}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/10 hover:text-accent transition-colors disabled:opacity-50"
                      title="Draft reply with Kai"
                    >
                      {aiReplyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </button>
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors" title="Emoji">
                      <Smile className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className={`flex items-end gap-2 rounded-lg border bg-surface p-2.5 transition-colors ${
                  msgType === "note" ? "border-yellow-300" : "border-border"
                }`}>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={msgType === "reply" ? "Type your reply... (Enter to send, Shift+Enter for new line)" : "Write an internal note..."}
                    rows={1}
                    className="min-h-[38px] flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim() || sending}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:opacity-90 disabled:opacity-30 ${
                      msgType === "note" ? "bg-yellow-600 text-white" : "bg-ink text-primary-foreground"
                    }`}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right — Details | Copilot */}
        {showDetails && activeConvo && (
          <div className="hidden md:flex w-72 shrink-0 flex-col border-l border-border">
            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setDetailTab("details")}
                className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                  detailTab === "details"
                    ? "text-ink border-b-2 border-ink"
                    : "text-muted-foreground hover:text-ink"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Details
              </button>
              <button
                onClick={() => setDetailTab("copilot")}
                className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                  detailTab === "copilot"
                    ? "text-ink border-b-2 border-ink"
                    : "text-muted-foreground hover:text-ink"
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                Copilot
              </button>
            </div>

            {detailTab === "details" ? (
              <DetailsContent activeConvo={activeConvo} formatTime={formatTime} teams={teams} agents={agents} onTeamChange={handleTeamChange} onAssign={handleAssign} />
            ) : (
              /* Copilot tab */
              <div className="flex flex-1 flex-col">
                <div className="flex-1 overflow-y-auto p-3">
                  {copilotMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Bot className="h-8 w-8 text-muted-foreground/40 mb-2" />
                      <p className="text-xs text-muted-foreground">Ask me anything about this conversation</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {copilotMessages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                            m.role === "user"
                              ? "bg-ink text-primary-foreground"
                              : "bg-surface border border-border text-ink"
                          }`}>
                            <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                          </div>
                        </div>
                      ))}
                      {copilotLoading && (
                        <div className="flex justify-start">
                          <div className="rounded-lg bg-surface border border-border px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "0ms" }} />
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "150ms" }} />
                              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={copilotEndRef} />
                    </div>
                  )}
                </div>

                {/* Quick suggestions */}
                {copilotMessages.length === 0 && (
                  <div className="px-3 pb-2">
                    <div className="flex flex-wrap gap-1.5">
                      {copilotSuggestions.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => handleCopilotSend(s.key)}
                          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-ink transition-colors"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Copilot input */}
                <div className="border-t border-border p-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5">
                    <input
                      value={copilotInput}
                      onChange={(e) => setCopilotInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCopilotSend(); } }}
                      placeholder="Ask Copilot..."
                      className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      onClick={() => handleCopilotSend()}
                      disabled={!copilotInput.trim() || copilotLoading}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-ink disabled:opacity-30 transition-colors"
                    >
                      <Send className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailsContent({ activeConvo, formatTime, teams, agents, onTeamChange, onAssign }: {
  activeConvo: ConversationDetail;
  formatTime: (iso: string) => string;
  teams: Team[];
  agents: Agent[];
  onTeamChange: (teamId?: string) => void;
  onAssign: (assigneeId?: string) => void;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    conversation: true,
    assignment: true,
    contact: true,
    notes: false,
    timeline: true,
    device: false,
    past: false,
  });
  const [pastConvos, setPastConvos] = useState<Conversation[]>([]);
  const [pastLoading, setPastLoading] = useState(false);

  useEffect(() => {
    if (activeConvo.customer_email && openGroups.past) {
      setPastLoading(true);
      fetchPastConversations(activeConvo.customer_email, activeConvo.id)
        .then(setPastConvos)
        .catch(() => setPastConvos([]))
        .finally(() => setPastLoading(false));
    }
  }, [activeConvo.id, activeConvo.customer_email, openGroups.past]);

  const toggle = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?";

  const priorityDot = (p: string) => {
    if (p === "urgent") return "bg-red-500";
    if (p === "high") return "bg-orange-500";
    if (p === "normal") return "bg-blue-500";
    return "bg-surface-2";
  };

  const label = (text: string) => (
    <p className="text-[11px] font-medium text-muted-foreground/60">{text}</p>
  );

  const notes = activeConvo.messages?.filter((m) => m.type === "note") || [];
  const hasBrowser = Object.keys(activeConvo.browser || {}).length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Identity card */}
      <div className="flex flex-col items-center border-b border-border px-3 py-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
          {getInitials(activeConvo.customer_name || activeConvo.customer_email)}
        </div>
        <h4 className="mt-2.5 text-sm font-semibold text-ink">
          {activeConvo.customer_name || activeConvo.customer_email || `Visitor #${activeConvo.ticket_id}`}
        </h4>
        {activeConvo.customer_email && (
          <p className="text-xs text-muted-foreground">{activeConvo.customer_email}</p>
        )}
        {activeConvo.location && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Globe className="h-3 w-3" />
            {activeConvo.location}
          </p>
        )}
      </div>

      {/* Accordion groups */}
      <div className="divide-y divide-border">
        {/* Conversation */}
        <div>
          <button
            onClick={() => toggle("conversation")}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.conversation ? "rotate-90" : ""}`} />
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            Conversation
          </button>
          {openGroups.conversation && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                {label("Status")}
                <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    activeConvo.status === "open" ? "bg-green-500" :
                    activeConvo.status === "pending" ? "bg-yellow-500" : "bg-surface-2"
                  }`} />
                  {activeConvo.status.charAt(0).toUpperCase() + activeConvo.status.slice(1)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                {label("ID")}
                <button
                  onClick={() => { navigator.clipboard.writeText(activeConvo.id); }}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-ink transition-colors font-mono"
                  title="Click to copy full ID"
                >
                  <Hash className="h-3 w-3 shrink-0" />
                  {activeConvo.ticket_id}
                </button>
              </div>
              <div className="flex items-center justify-between">
                {label("Priority")}
                <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDot(activeConvo.priority)}`} />
                  {activeConvo.priority.charAt(0).toUpperCase() + activeConvo.priority.slice(1)}
                </span>
              </div>
              {activeConvo.sla_status && activeConvo.sla_status !== "none" && (
                <div className="flex items-center justify-between">
                  {label("SLA")}
                  <SLABadge
                    status={activeConvo.sla_status}
                    timeRemaining={activeConvo.sla_time_remaining}
                    deadline={activeConvo.sla_deadline}
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                {label("Channel")}
                <span className="text-xs font-medium text-ink capitalize">{activeConvo.channel}</span>
              </div>
              {activeConvo.subject && (
                <div className="flex items-center justify-between">
                  {label("Subject")}
                  <span className="text-xs font-medium text-ink text-right max-w-[60%] truncate">{activeConvo.subject}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                {label("Messages")}
                <span className="text-xs font-medium text-ink">{activeConvo.message_count}</span>
              </div>
            </div>
          )}
        </div>

        {/* Assignment */}
        <div>
          <button
            onClick={() => toggle("assignment")}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.assignment ? "rotate-90" : ""}`} />
            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
            Assignment
          </button>
          {openGroups.assignment && (
            <div className="px-3 pb-3 space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground/60">Team</p>
                <select
                  value={activeConvo.team?.id || ""}
                  onChange={(e) => onTeamChange(e.target.value || undefined)}
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground/60">Assignee</p>
                <select
                  value={activeConvo.assignee?.id || ""}
                  onChange={(e) => onAssign(e.target.value || undefined)}
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.email}</option>
                  ))}
                </select>
              </div>
              {activeConvo.team && (
                <p className="text-[10px] text-muted-foreground">
                  Auto-assigns the least busy team member
                </p>
              )}
            </div>
          )}
        </div>

        {/* Contact */}
        <div>
          <button
            onClick={() => toggle("contact")}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.contact ? "rotate-90" : ""}`} />
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Contact
          </button>
          {openGroups.contact && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                {label("Email")}
                <span className="text-xs font-medium text-ink truncate max-w-[65%]">{activeConvo.customer_email || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                {label("Phone")}
                <span className="text-xs text-muted-foreground">Not provided</span>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <button
            onClick={() => toggle("notes")}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.notes ? "rotate-90" : ""}`} />
            <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
            Notes
            {notes.length > 0 && (
              <span className="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">{notes.length}</span>
            )}
          </button>
          {openGroups.notes && (
            <div className="px-3 pb-3 space-y-2">
              {notes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No notes yet</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-yellow-200 bg-yellow-50 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-yellow-700">{n.sender_name || "Agent"}</span>
                      <span className="text-[10px] text-yellow-500">{formatTime(n.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-yellow-800 whitespace-pre-wrap leading-relaxed">{n.body}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div>
          <button
            onClick={() => toggle("timeline")}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.timeline ? "rotate-90" : ""}`} />
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            Timeline
          </button>
          {openGroups.timeline && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                {label("Created")}
                <span className="text-xs font-medium text-ink">
                  {new Date(activeConvo.created_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                {label("Last activity")}
                <span className="text-xs font-medium text-ink">{formatTime(activeConvo.last_message_at || activeConvo.created_at)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Device */}
        {hasBrowser && (
          <div>
            <button
              onClick={() => toggle("device")}
              className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
            >
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.device ? "rotate-90" : ""}`} />
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
              Device
            </button>
            {openGroups.device && (
              <div className="px-3 pb-3 space-y-2">
                {Object.entries(activeConvo.browser).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    {label(key.charAt(0).toUpperCase() + key.slice(1))}
                    <span className="text-xs font-medium text-ink truncate max-w-[60%]">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Past Conversations */}
        {activeConvo.customer_email && (
          <div>
            <button
              onClick={() => toggle("past")}
              className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
            >
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openGroups.past ? "rotate-90" : ""}`} />
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              Past conversations
            </button>
            {openGroups.past && (
              <div className="px-3 pb-3 space-y-1.5">
                {pastLoading ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : pastConvos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No past conversations</p>
                ) : (
                  pastConvos.map((pc) => (
                    <div key={pc.id} className="flex items-center justify-between rounded-md border border-border bg-surface px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink">{pc.subject || pc.customer_name || "Conversation"}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                            pc.status === "open" ? "bg-green-500" :
                            pc.status === "pending" ? "bg-yellow-500" : "bg-surface-2"
                          }`} />
                          <span className="text-[10px] text-muted-foreground capitalize">{pc.status}</span>
                          {pc.last_message && (
                            <span className="text-[10px] text-muted-foreground">{formatTime(pc.last_message.created_at)}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground capitalize">{pc.channel}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
