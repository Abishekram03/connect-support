"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api-client";
import { playNotificationSound, playEscalationSound } from "@/lib/notification-sound";

export interface Notification {
  id: number;
  type: "new_conversation" | "new_message" | "assignment" | "mention" | "escalation";
  title: string;
  body: string;
  conversation_id: number | null;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const lastCheckRef = useRef<string>(new Date().toISOString());
  const isFirstCheck = useRef(true);

  const checkNotifications = useCallback(async () => {
    try {
      // First check loads history (no `after`) so notifications persist after refresh;
      // subsequent polls only fetch what's new.
      const params: Record<string, string> = { limit: "8" };
      if (!isFirstCheck.current) {
        params["after"] = lastCheckRef.current;
      }
      const res = await api.get<{ results: Notification[] }>("/api/notifications", { params });
      const newNotifs = res.results || [];
      const isFirst = isFirstCheck.current;
      // Play sound on new notifications (skip first check to avoid sound on page load)
      if (!isFirst && newNotifs.length > 0 && localStorage.getItem("notification_sound") !== "off") {
        const hasEscalation = newNotifs.some((n) => n.type === "escalation");
        if (hasEscalation) {
          playEscalationSound();
        } else {
          playNotificationSound();
        }
      }
      isFirstCheck.current = false;
      setNotifications((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const fresh = newNotifs.filter((n) => !existing.has(n.id));
        return [...fresh, ...prev].slice(0, 8);
      });
      setUnreadCount((prev) => {
        const freshUnread = newNotifs.filter((n) => !n.read).length;
        return isFirst ? freshUnread : prev + freshUnread;
      });
      lastCheckRef.current = new Date().toISOString();
    } catch {}
    setLoading(false);
  }, []);

  const markAsRead = useCallback(async (id: number) => {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {}
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await api.post("/api/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  }, []);

  useEffect(() => {
    checkNotifications();
    const interval = setInterval(() => checkNotifications(), 10000);
    return () => clearInterval(interval);
  }, [checkNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: checkNotifications,
  };
}
