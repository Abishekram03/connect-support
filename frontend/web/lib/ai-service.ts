import { api } from "./api-client";

export interface AIConfig {
  id: string;
  auto_reply_enabled: boolean;
  reply_generation_enabled: boolean;
  model_name: string;
  embedding_model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  escalate_on_angry: boolean;
  escalate_on_low_confidence: boolean;
  confidence_threshold: number;
  max_ai_turns: number;
  provider_base_url: string;
  provider_api_key: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSource {
  id: string;
  source_type: string;
  external_id: string;
  title: string;
  content: string;
  url: string;
  is_indexed: boolean;
  chunk_count: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIReplyLog {
  id: string;
  conversation: string;
  model_used: string;
  prompt_tokens: number;
  completion_tokens: number;
  confidence: number;
  escalated: boolean;
  escalation_reason: string;
  sources_used: string[];
  response_text: string;
  created_at: string;
}

export async function fetchAIConfig(): Promise<AIConfig> {
  return api.get("/api/ai/config");
}

export async function updateAIConfig(data: Partial<AIConfig>): Promise<AIConfig> {
  return api.patch("/api/ai/config", data);
}

export async function fetchSources(): Promise<KnowledgeSource[]> {
  return api.get("/api/ai/sources");
}

export async function createSource(data: {
  source_type: string;
  title: string;
  content?: string;
  url?: string;
  external_id?: string;
}): Promise<KnowledgeSource> {
  return api.post("/api/ai/sources", data);
}

export async function deleteSource(id: string): Promise<void> {
  return api.delete(`/api/ai/sources/${id}`);
}

export async function syncSource(id: string): Promise<{ chunk_count: number; is_indexed: boolean }> {
  return api.post(`/api/ai/sources/${id}/sync`);
}

export async function syncAllSources(): Promise<{
  total_chunks: number;
  sources_synced: number;
  errors: { source_id: string; error: string }[];
}> {
  return api.post("/api/ai/sources/sync-all");
}

export async function syncKBToSources(): Promise<{ synced: number }> {
  return api.post("/api/ai/sources/sync-kb");
}

export async function suggestReply(conversationId: string): Promise<{ suggestions: string[] }> {
  return api.post("/api/ai/suggest-reply", { conversation_id: conversationId });
}

export async function generateReplyOptions(conversationId: string): Promise<{ options: string[]; language: string }> {
  return api.post("/api/ai/reply-options", { conversation_id: conversationId });
}

export async function summarizeConversation(conversationId: string): Promise<{ summary: string }> {
  return api.post("/api/ai/summarize", { conversation_id: conversationId });
}

export async function getNextSteps(conversationId: string): Promise<{ steps: string[] }> {
  return api.post("/api/ai/next-steps", { conversation_id: conversationId });
}

export async function fetchAIReplyLogs(): Promise<AIReplyLog[]> {
  return api.get("/api/ai/logs");
}

export interface SLAConfig {
  id: string;
  enabled: boolean;
  urgent_hours: number;
  high_hours: number;
  normal_hours: number;
  low_hours: number;
  warn_before_minutes: number;
  created_at: string;
  updated_at: string;
}

export async function fetchSLAConfig(): Promise<SLAConfig> {
  return api.get("/api/ai/sla-config");
}

export async function updateSLAConfig(data: Partial<SLAConfig>): Promise<SLAConfig> {
  return api.patch("/api/ai/sla-config", data);
}
