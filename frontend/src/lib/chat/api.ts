import type { ChatMessage } from './types';

export type ChatHistoryResponse = {
  messages: Array<{ id: string; sender: 'user' | 'ai'; text: string }>;
};

export type SendMessageResponse = {
  sessionId: string;
  reply: string;
};

// In prod (Vercel) the backend lives on a different origin. Use env when provided.
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const VISITOR_HEADER = 'x-visitor-id';

export async function apiFetch(visitorId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(VISITOR_HEADER, visitorId);
  const url = `${API_BASE}${path}`;
  console.log("[API] Fetching", { url, method: init.method || 'GET', visitorId });
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    console.error("[API] Response error", { status: res.status, statusText: res.statusText, body: text });
  }
  return res;
}

export async function fetchHistory(params: {
  visitorId: string;
  sessionId: string;
}): Promise<ChatMessage[]> {
  const res = await apiFetch(
    params.visitorId,
    `/chat/history?sessionId=${encodeURIComponent(params.sessionId)}`
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to load history (${res.status})`);
  }

  const data = (await res.json()) as ChatHistoryResponse;
  return data.messages.map((m) => ({ id: m.id, sender: m.sender, text: m.text }));
}

export async function sendMessage(params: {
  visitorId: string;
  sessionId: string;
  message: string;
  clientMessageId: string;
}): Promise<SendMessageResponse> {
  const res = await apiFetch(params.visitorId, '/chat/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: params.sessionId,
      message: params.message,
      clientMessageId: params.clientMessageId,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Send failed (${res.status})`);
  }

  return (await res.json()) as SendMessageResponse;
}

export async function health(visitorId: string): Promise<void> {
  await apiFetch(visitorId, '/health').catch(() => null);
}
