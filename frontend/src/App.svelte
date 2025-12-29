<script lang="ts">
  import { afterUpdate, onMount, tick } from 'svelte'
  import ChatMessageRow from './components/ChatMessage.svelte'
  import TypingIndicator from './components/TypingIndicator.svelte'
  import type { ChatMessage } from './lib/chat/types'
  import { newClientMessageId } from './lib/chat/ids'
  import { isNearBottom } from './lib/chat/scroll'
  import { getOrCreateVisitorId, getStoredSessionId, setSessionId } from './lib/chat/storage'
  import { fetchHistory, health, sendMessage } from './lib/chat/api'

  let visitorId = ''
  let sessionId: string | null = null

  let messages: ChatMessage[] = []
  let draft = ''
  let sending = false
  let error: string | null = null

  let chatEl: HTMLElement | null = null
  let lastRenderedCount = 0
  let autoScroll = true

  async function loadHistory() {
    if (!sessionId) return
    messages = await fetchHistory({ visitorId, sessionId })
  }

  async function send() {
    error = null
    const text = draft.trim()
    if (!text || sending) return

    sending = true
    draft = ''

    const localId = newClientMessageId()
    messages = [...messages, { id: localId, sender: 'user', text }]

    try {
      const data = await sendMessage({
        visitorId,
        sessionId: sessionId ?? undefined,
        message: text,
        clientMessageId: localId
      })

      if (typeof data?.sessionId === 'string' && data.sessionId.length > 0) {
        sessionId = data.sessionId
        setSessionId(sessionId)
      }

      if (typeof data?.reply === 'string' && data.reply.trim().length > 0) {
        messages = [...messages, { id: newClientMessageId(), sender: 'ai', text: data.reply }]
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error'
    } finally {
      sending = false
    }
  }

  async function scrollToLatest() {
    if (!chatEl) return
    await tick()
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' })
  }

  function onChatScroll() {
    if (!chatEl) return
    autoScroll = isNearBottom(chatEl, 120)
  }

  afterUpdate(() => {
    // Only scroll when messages changed (avoid fighting the user while reading).
    if (messages.length !== lastRenderedCount) {
      lastRenderedCount = messages.length
      if (autoScroll) void scrollToLatest()
    }
  })

  onMount(async () => {
    visitorId = getOrCreateVisitorId()
    sessionId = getStoredSessionId()

    try {
      // Establish visitor cookie for anything that relies on cookies.
      await health(visitorId)
      await loadHistory()
      await scrollToLatest()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to initialize'
    }
  })
</script>

<main class="page">
  <header class="header">
    <h1>Support Chat</h1>
    <div class="meta">
      <div>Visitor: {visitorId.slice(0, 8)}…</div>
      {#if sessionId}
        <div>Session: {sessionId.slice(0, 8)}…</div>
      {/if}
    </div>
  </header>

  <section
    class="chat"
    aria-label="Chat messages"
    bind:this={chatEl}
    on:scroll={onChatScroll}
  >
    {#if messages.length === 0}
      <div class="empty">Ask a question to start the conversation.</div>
    {:else}
      {#each messages as m (m.id)}
        <ChatMessageRow sender={m.sender} text={m.text} />
      {/each}

      {#if sending}
        <div class="bubble ai typing" aria-live="polite">
          <div class="sender">Agent</div>
          <div class="text">
            <TypingIndicator />
          </div>
        </div>
      {/if}
    {/if}
  </section>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  <form
    class="composer"
    on:submit|preventDefault={() => {
      void send()
    }}
  >
    <input
      class="input"
      placeholder="Type your message… (Enter to send)"
      bind:value={draft}
      disabled={sending}
      aria-label="Message"
    />
    <button class="button" type="submit" disabled={sending || draft.trim().length === 0}>
      {sending ? 'Sending…' : 'Send'}
    </button>
  </form>
</main>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 28px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 2px;
  }

  .header h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: 0.2px;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    opacity: 0.8;
    font-size: 12px;
  }

  .chat {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 14px;
    min-height: 360px;
    max-height: calc(100vh - 210px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(10px);
  }

  .empty {
    opacity: 0.7;
    margin: auto;
  }

  :global(.bubble) {
    max-width: 90%;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.25);
  }

  :global(.bubble.user) {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.12);
  }

  :global(.bubble.ai) {
    margin-right: auto;
  }

  :global(.typing .text) {
    display: flex;
    align-items: center;
    min-height: 20px;
  }

  :global(.dots) {
    display: inline-flex;
    gap: 6px;
  }

  :global(.dot) {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.7);
    animation: blink 1.2s infinite ease-in-out;
  }

  :global(.dot:nth-child(2)) {
    animation-delay: 0.15s;
  }

  :global(.dot:nth-child(3)) {
    animation-delay: 0.3s;
  }

  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-1px);
    }
  }

  :global(.sender) {
    font-size: 12px;
    opacity: 0.8;
    margin-bottom: 4px;
  }

  :global(.text) {
    white-space: pre-wrap;
    line-height: 1.35;
  }

  .composer {
    display: flex;
    gap: 8px;
    padding: 2px;
  }

  .input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.2);
    color: inherit;
  }

  .input:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.3);
  }

  .button {
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    cursor: pointer;
  }

  .button:hover:enabled {
    background: rgba(255, 255, 255, 0.12);
  }

  .button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    border: 1px solid rgba(255, 0, 0, 0.35);
    background: rgba(255, 0, 0, 0.08);
    padding: 10px 12px;
    border-radius: 10px;
  }
</style>
