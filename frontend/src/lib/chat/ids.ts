export function newClientMessageId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
}
