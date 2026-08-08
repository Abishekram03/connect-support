"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";
import { Button } from "@connect/ui/components/button";
import { ArrowLeftIcon, SendIcon, Loader2Icon, SmileIcon } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  conversationIdAtom,
  screenAtom,
  widgetConfigAtom,
  organizationIdAtom,
  contactEmailAtomFamily,
  contactNameAtomFamily,
  isHistoricalConversationAtom,
} from "../../atoms/widget-atoms";
import { GreetingMessage } from "../components/greeting-message";
import { BrandLogo } from "../components/brand-logo";
import {
  startConversation,
  sendMessage,
  fetchMessages,
  fetchConversations,
  updateConversation,
  type MessageResponse,
} from "../../../../lib/widget-api";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
});

interface Props {
  mode?: "preview" | "production";
}

export const WidgetChatScreen = ({ mode = "production" }: Props) => {
  const setScreen = useSetAtom(screenAtom);
  const setConversationId = useSetAtom(conversationIdAtom);
  const orgId = useAtomValue(organizationIdAtom);
  const widgetConfig = useAtomValue(widgetConfigAtom);
  const conversationId = useAtomValue(conversationIdAtom);
  const isHistorical = useAtomValue(isHistoricalConversationAtom);
  const setContactName = useSetAtom(contactNameAtomFamily(orgId || ""));
  const setContactEmail = useSetAtom(contactEmailAtomFamily(orgId || ""));
  const storedEmail = useAtomValue(contactEmailAtomFamily(orgId || ""));

  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [initialLoading, setInitialLoading] = useState(!!conversationId);
  const [hasStarted, setHasStarted] = useState(!!conversationId);
  const lastTimestampRef = useRef<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [connState, setConnState] = useState<{
    state: "ai" | "connecting" | "connected" | "queued";
    name?: string;
  }>({ state: "ai" });
  const connectedAnnounced = useRef(false);

  useEffect(() => {
    connectedAnnounced.current = false;
  }, [conversationId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const convStartedRef = useRef(false);

  const dedupeMessages = (items: MessageResponse[]) => {
    const seen = new Set<string>();
    const unique: MessageResponse[] = [];
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
    }
    return unique;
  };

  const mergeMessages = (
    existing: MessageResponse[],
    incoming: MessageResponse[],
  ) => dedupeMessages([...existing, ...incoming]);

  // Load existing messages when viewing a past conversation
  useEffect(() => {
    if (!conversationId || !isHistorical || messages.length > 0) return;
    fetchMessages(conversationId, undefined, orgId)
      .then((msgs) => {
        const uniqueMsgs = dedupeMessages(msgs);
        setMessages(uniqueMsgs);
        if (uniqueMsgs.length > 0) {
          lastTimestampRef.current = uniqueMsgs[uniqueMsgs.length - 1].created_at;
        }
        setInitialLoading(false);
      })
      .catch(() => setInitialLoading(false));
  }, [conversationId, isHistorical]);

  // Poll for new messages
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  useEffect(() => {
    if (!conversationId || !hasStarted) return;

    const poll = () => {
      pollingRef.current = setTimeout(async () => {
        try {
          const cid = conversationIdRef.current;
          if (!cid) return;
          const since = lastTimestampRef.current || undefined;
          const newMsgs = await fetchMessages(cid, since, orgId);
          if (newMsgs.length > 0) {
            setMessages((prev) => {
              const existing = new Set(prev.map((m) => m.id));
              const fresh = newMsgs.filter((m) => !existing.has(m.id));
              return [...prev, ...fresh];
            });
            lastTimestampRef.current = newMsgs[newMsgs.length - 1].created_at;
          }
        } catch {}
        poll();
      }, 3000);
    };

    poll();
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [conversationId, hasStarted]);

  // Poll conversation status to show when a human agent connects
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;

    const check = async () => {
      try {
        const list = await fetchConversations(undefined, orgId);
        if (cancelled) return;
        const conv = list.find((c) => c.id === conversationIdRef.current);
        if (!conv) return;
        if (conv.first_response_at) {
          const name = conv.assignee?.name || "Agent";
          setConnState({ state: "connected", name });
          if (!connectedAnnounced.current) {
            connectedAnnounced.current = true;
            const sysMsg: MessageResponse = {
              id: `sys-conn-${Date.now()}`,
              type: "system",
              body: `You're now connected with ${name}`,
              original_body: "",
              sender: null,
              sender_name: "System",
              is_from_customer: false,
              read_at: null,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, sysMsg]);
          }
        } else if (conv.handoff_requested_at) {
          if (conv.assignee) {
            setConnState({ state: "connecting" });
          } else {
            setConnState({ state: "queued" });
          }
        }
      } catch {}
    };

    check();
    const timer = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orgId, hasStarted]);

  // Create conversation on first message
  useEffect(() => {
    if (hasStarted || convStartedRef.current || !orgId) return;

    const email = storedEmail || "";

    const init = async () => {
      // Check for existing open conversation
      try {
        const existing = await fetchConversations(email || undefined, orgId);
        if (existing.length > 0) {
          const conv = existing[0];
          setConversationId(conv.id);
          convStartedRef.current = true;
          setHasStarted(true);
          const msgs = await fetchMessages(conv.id, undefined, orgId);
          const uniqueMsgs = dedupeMessages(msgs);
          setMessages(uniqueMsgs);
          if (uniqueMsgs.length > 0) {
            lastTimestampRef.current = uniqueMsgs[uniqueMsgs.length - 1].created_at;
          }
          setInitialLoading(false);
          return;
        }
      } catch {}
      setInitialLoading(false);
    };

    init();
  }, [orgId, storedEmail]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputValue.trim();
    if (!content || isSending) return;

    setInputValue("");

    // If no conversation yet, create one with this first message
    if (!conversationId) {
      if (!orgId) return;

      // Show message optimistically
      const localMsg: MessageResponse = {
        id: `local-${Date.now()}`,
        type: "reply",
        body: content,
        original_body: "",
        sender: null,
        sender_name: "You",
        is_from_customer: true,
        read_at: null,
        created_at: new Date().toISOString(),
      };
      setMessages([localMsg]);
      setIsSending(true);

      try {
        // Create conversation
        const conv = await startConversation(orgId, {
          customer_name: customerName || undefined,
          customer_email: customerEmail || storedEmail || undefined,
          subject: content,
        });
        setConversationId(conv.id);
        convStartedRef.current = true;
        setHasStarted(true);

        // Send the message
        const msg = await sendMessage(conv.id, content, orgId || undefined);

        // Replace local message with real one + AI reply
        setMessages(() => {
          const result: MessageResponse[] = [msg];
          if (msg.ai_reply && msg.ai_reply.body) {
            result.push({
              id: msg.ai_reply.id,
              type: "reply",
              body: msg.ai_reply.body,
              original_body: msg.ai_reply.original_body || "",
              detected_language: msg.ai_reply.detected_language || "",
              sender: null,
              sender_name: "Kai",
              is_from_customer: false,
              read_at: null,
              created_at: new Date().toISOString(),
            });
          }
          return dedupeMessages(result);
        });
        lastTimestampRef.current = msg.created_at;
      } catch {
        setMessages([]);
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Existing conversation — just send
    setIsSending(true);
    try {
      const msg = await sendMessage(conversationId, content, orgId || undefined);

      // Passive name/email detection from any customer message
      if (msg.is_from_customer) {
        const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        // Match name patterns in multiple languages
        const nameMatch = content.match(
          /(?:my name is|i'm|i am|name:?(?:\s+is)?|meu nome é|mi nombre es|mon nom est|mein name ist|ik ben|je m'appelle|mi chiamo|ich bin)\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i
        );
        let detectedEmail = emailMatch ? emailMatch[0].toLowerCase() : null;
        let detectedName = nameMatch ? nameMatch[1].trim() : null;

        // Also handle "Name, email" or "Name\nemail" format
        if (!emailMatch && !nameMatch) {
          const parts = content.split(/[,\n]+/).map(s => s.trim());
          if (parts.length >= 2) {
            const maybeEmail = parts.find(p => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(p));
            const maybeName = parts.find(p =>
              !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(p) &&
              /^[A-Za-z\s]{2,30}$/.test(p)
            );
            if (maybeEmail) detectedEmail = maybeEmail.toLowerCase();
            if (maybeName) detectedName = maybeName;
          }
        }

        if (detectedEmail && !customerEmail) {
          setCustomerEmail(detectedEmail);
          if (typeof window !== "undefined" && orgId) setContactEmail(detectedEmail);
        }
        if (detectedName && !customerName) {
          setCustomerName(detectedName);
          if (typeof window !== "undefined" && orgId) setContactName(detectedName);
        }
        if (orgId && conversationId && (detectedName || detectedEmail)) {
          try {
            await updateConversation(conversationId, orgId, {
              customer_name: detectedName || undefined,
              customer_email: detectedEmail || undefined,
            });
          } catch {}
        }
      }

      const newMsgs: MessageResponse[] = [msg];
      if (msg.ai_reply && msg.ai_reply.body) {
        newMsgs.push({
          id: msg.ai_reply.id,
          type: "reply",
          body: msg.ai_reply.body,
          original_body: msg.ai_reply.original_body || "",
          detected_language: msg.ai_reply.detected_language || "",
          sender: null,
          sender_name: "Kai",
          is_from_customer: false,
          read_at: null,
          created_at: new Date().toISOString(),
        });
      }
      setMessages((prev) => mergeMessages(prev, newMsgs));
      lastTimestampRef.current = msg.created_at;
    } catch {
    } finally {
      setIsSending(false);
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setInputValue((prev) => `${prev}${emojiData.emoji}`);
    textAreaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  };

  const onBack = () => {
    setConversationId(null);
    setScreen(isHistorical ? "inbox" : "selection");
  };

  const showGreeting = messages.length === 0 && !initialLoading;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 flex-col border-b border-neutral-200 bg-white px-2 pt-4 pb-2">
        <div className="flex items-center gap-x-2">
          <button
            onClick={onBack}
            className="rounded p-0.5 text-neutral-700 transition-colors hover:bg-neutral-100"
            aria-label="Back to conversations"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
          </button>
          <BrandLogo size={32} />
          <div>
            <p className="text-lg font-semibold text-neutral-900">{widgetConfig.companyName || "Support"}</p>
            {connState.state === "connected" ? (
              <p className="flex items-center gap-1 text-[12px] leading-tight text-neutral-600">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {connState.name} connected
              </p>
            ) : connState.state === "connecting" ? (
              <p className="flex items-center gap-1 text-[12px] leading-tight text-neutral-600">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Connecting you to an agent…
              </p>
            ) : connState.state === "queued" ? (
              <p className="flex items-center gap-1 text-[12px] leading-tight text-neutral-600">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Agents busy — you're in the queue
              </p>
            ) : (
              <p className="text-[12px] leading-tight text-neutral-500">
                Support Team
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scroll-smooth">
        {initialLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="h-5 w-5 animate-spin text-neutral-400" />
          </div>
        )}

        {showGreeting && (
          <GreetingMessage
            agentName="Kai"
            primaryColor={widgetConfig.primaryColor}
          />
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.type === "system" ? (
              <div className="flex justify-center px-2 py-1">
                <p className="max-w-[90%] rounded-full bg-neutral-100 px-3 py-1 text-center text-[10px] text-neutral-500">
                  {msg.body}
                </p>
              </div>
            ) : (
          <div
            className={`flex gap-2 ${msg.is_from_customer ? "justify-end" : "justify-start"}`}
          >
            {!msg.is_from_customer && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden mt-1">
                {msg.sender_name === "Kai" ? (
                  <img src="/KAI_Logo.png" alt="Kai" className="h-6 w-6 object-contain" />
                ) : (
                  <span className="text-[8px] font-medium text-neutral-500">
                    {msg.sender_name ? msg.sender_name.charAt(0).toUpperCase() : "A"}
                  </span>
                )}
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${
                msg.is_from_customer
                  ? "text-white"
                  : "bg-neutral-100 text-neutral-900"
              }`}
              style={
                msg.is_from_customer
                  ? { backgroundColor: widgetConfig.primaryColor }
                  : undefined
              }
            >
              {!msg.is_from_customer && (
                <p className="mb-1 text-[10px] font-medium text-neutral-500">
                  {msg.sender_name || "Agent"}
                </p>
              )}
              <p className="whitespace-pre-wrap break-words">
                {msg.is_from_customer && msg.original_body
                  ? msg.original_body
                  : msg.body}
              </p>
              <p className="mt-1 text-[9px] text-neutral-500">
                {new Date(msg.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="shrink-0 border-t border-neutral-200 bg-white p-3"
      >
        <div className="relative rounded-3xl border border-neutral-200 bg-white px-3 py-2 shadow-[0_6px_20px_rgb(0_0_0_/_0.08)]">
          {isEmojiPickerOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-2 w-[min(92vw,280px)] max-w-[280px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_28px_rgb(0_0_0_/_0.16)]">
              <div className="max-h-[320px] overflow-y-auto overflow-x-hidden">
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  autoFocusSearch={false}
                  searchDisabled={false}
                  lazyLoadEmojis={true}
                  skinTonesDisabled={false}
                  width="100%"
                  height={320}
                />
              </div>
            </div>
          )}

          <textarea
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            disabled={isSending}
            className="h-9 w-full resize-none bg-transparent px-1 py-1 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            rows={1}
          />

          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              className="rounded-full p-1 text-neutral-500 transition-colors hover:text-neutral-700"
              aria-label="Open emoji selector"
              onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
            >
              <SmileIcon className="h-5 w-5" />
            </button>

            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full border-0"
              style={{
                backgroundColor: widgetConfig.primaryColor,
                color: "#ffffff",
              }}
              disabled={!inputValue.trim() || isSending}
            >
              {isSending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SendIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};
