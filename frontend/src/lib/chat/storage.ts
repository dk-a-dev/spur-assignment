const VISITOR_ID_KEY = 'spur.chat.visitorId';
const SESSION_ID_KEY = 'spur.chat.sessionId';

function getOrCreateId(key: string): string {
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  localStorage.setItem(key, created);
  return created;
}

export function getOrCreateVisitorId(): string {
  return getOrCreateId(VISITOR_ID_KEY);
}

export function getOrCreateSessionId(): string {
  return getOrCreateId(SESSION_ID_KEY);
}

export function getStoredSessionId(): string | null {
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return null;
  if (sessionId.trim().length === 0) return null;
  return sessionId;
}

export function setSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_ID_KEY, sessionId);
}
