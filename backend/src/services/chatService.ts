import { prisma } from "../db/prisma";
import { env } from "../config";
import { getFaqContext } from "./faqService";
import { generateReply, type ChatTurn } from "../llm/gemini";
import { redis } from "../infra/redis";
import { createHash } from "crypto";

const SYSTEM_PROMPT =
  "You are a helpful support agent for a small e-commerce store. Answer clearly and concisely. If the answer is not in the provided FAQ/policies, say you are not sure and suggest contacting support.";

function clampMessageText(text: string) {
  const trimmed = text.trim();
  const maxLen = 2000;
  if (trimmed.length <= maxLen) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, maxLen), truncated: true };
}

export async function getOrCreateVisitor(externalId: string) {
  return prisma.visitor.upsert({
    where: { externalId },
    create: { externalId },
    update: {}
  });
}

async function findActiveConversations(visitorId: string) {
  const ttlMs = env.ACTIVE_CONVERSATION_TTL_MINUTES * 60_000;
  const since = new Date(Date.now() - ttlMs);

  return prisma.conversation.findMany({
    where: { visitorId, lastMessageAt: { gt: since } },
    orderBy: { lastMessageAt: "desc" },
    take: env.MAX_ACTIVE_CONVERSATIONS
  });
}

async function getOrCreateConversation(params: {
  visitorId: string;
  sessionId?: string;
}) {
  if (params.sessionId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: params.sessionId, visitorId: params.visitorId }
    });
    if (existing) return existing;
  }

  // Enforce max active conversations; if exceeded, reuse most recent.
  const active = await findActiveConversations(params.visitorId);
  if (active.length >= env.MAX_ACTIVE_CONVERSATIONS) {
    return active[0];
  }

  return prisma.conversation.create({
    data: {
      visitorId: params.visitorId
    }
  });
}

async function getHistory(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" }
  });

  // Keep context small for cost control: last 20 turns.
  const recent = messages.slice(Math.max(0, messages.length - 20));

  const history: ChatTurn[] = recent
    .filter((m) => m.sender === "user" || m.sender === "ai")
    .map((m) => ({
      role: m.sender === "user" ? "user" : "model",
      text: m.text
    }));

  return { messages, history };
}

function normalizeForCache(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export async function postUserMessage(params: {
  externalVisitorId: string;
  message: string;
  sessionId?: string;
  clientMessageId?: string;
}) {
  const { text, truncated } = clampMessageText(params.message);
  const truncationNote = "\n\n(Note: Your message was truncated to 2000 characters.)";
  if (text.length === 0) {
    return {
      ok: false as const,
      status: 400,
      error: "Message cannot be empty."
    };
  }

  const visitor = await getOrCreateVisitor(params.externalVisitorId);
  const conversation = await getOrCreateConversation({
    visitorId: visitor.id,
    sessionId: params.sessionId
  });

  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "user",
        text,
        clientMessageId: params.clientMessageId
      }
    });
  } catch (e: any) {
    // Idempotency: if same clientMessageId was already stored, continue.
    // Prisma unique constraint violation code is P2002.
    if (e?.code !== "P2002") throw e;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() }
  });

  const faqContext = await getFaqContext();
  const { history } = await getHistory(conversation.id);

  // Cache only for "low-context" questions (e.g., first user message)
  // to avoid serving context-dependent answers incorrectly.
  const canUseCache = history.length <= 2;
  const cacheKey = canUseCache
    ? `cache:reply:${env.GEMINI_MODEL}:${sha256(faqContext)}:${sha256(normalizeForCache(text))}`
    : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && cached.trim().length > 0) {
        const replyForUser = truncated ? `${cached}${truncationNote}` : cached;
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: "ai",
            text: replyForUser
          }
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() }
        });

        return {
          ok: true as const,
          sessionId: conversation.id,
          reply: replyForUser
        };
      }
    } catch {
      // Cache is best-effort.
    }
  }

  let reply: string;
  try {
    reply = await generateReply({
      systemPrompt: SYSTEM_PROMPT,
      faqContext,
      history,
      userMessage: text
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("LLM failed for sync message:", e);
    reply =
      "Sorry — I’m having trouble reaching the support agent brain right now. Please try again in a moment.";
  }

  const replyForUser = truncated ? `${reply}${truncationNote}` : reply;

  if (cacheKey) {
    try {
      await redis.set(cacheKey, reply, "EX", env.CACHE_TTL_SECONDS);
    } catch {
      // ignore
    }
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      sender: "ai",
      text: replyForUser
    }
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() }
  });

  return {
    ok: true as const,
    sessionId: conversation.id,
    reply: replyForUser
  };
}

export async function persistUserMessage(params: {
  externalVisitorId: string;
  message: string;
  sessionId?: string;
  clientMessageId?: string;
}) {
  const { text, truncated } = clampMessageText(params.message);
  if (text.length === 0) {
    return {
      ok: false as const,
      status: 400,
      error: "Message cannot be empty."
    };
  }

  const visitor = await getOrCreateVisitor(params.externalVisitorId);
  const conversation = await getOrCreateConversation({
    visitorId: visitor.id,
    sessionId: params.sessionId
  });

  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "user",
        text,
        clientMessageId: params.clientMessageId
      }
    });
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() }
  });

  return {
    ok: true as const,
    sessionId: conversation.id,
    normalizedText: text,
    truncated
  };
}

export async function generateAndPersistAiReply(params: {
  conversationId: string;
  userMessage: string;
  truncated: boolean;
}) {
  const faqContext = await getFaqContext();
  const { history } = await getHistory(params.conversationId);

  const canUseCache = history.length <= 2;
  const cacheKey = canUseCache
    ? `cache:reply:${env.GEMINI_MODEL}:${sha256(faqContext)}:${sha256(normalizeForCache(params.userMessage))}`
    : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && cached.trim().length > 0) {
        await prisma.message.create({
          data: {
            conversationId: params.conversationId,
            sender: "ai",
            text: params.truncated
              ? `${cached}\n\n(Note: Your message was truncated to 2000 characters.)`
              : cached
          }
        });

        await prisma.conversation.update({
          where: { id: params.conversationId },
          data: { lastMessageAt: new Date() }
        });

        return { reply: cached, fromCache: true };
      }
    } catch {
      // ignore
    }
  }

  let reply: string;
  try {
    reply = await generateReply({
      systemPrompt: SYSTEM_PROMPT,
      faqContext,
      history,
      userMessage: params.userMessage
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("LLM failed for async job:", e);
    reply =
      "Sorry — I’m having trouble reaching the support agent brain right now. Please try again in a moment.";
  }

  if (cacheKey) {
    try {
      await redis.set(cacheKey, reply, "EX", env.CACHE_TTL_SECONDS);
    } catch {
      // ignore
    }
  }

  await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      sender: "ai",
      text: params.truncated
        ? `${reply}\n\n(Note: Your message was truncated to 2000 characters.)`
        : reply
    }
  });

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { lastMessageAt: new Date() }
  });

  return { reply, fromCache: false };
}

export async function fetchConversationHistory(params: {
  externalVisitorId: string;
  sessionId: string;
}) {
  const visitor = await getOrCreateVisitor(params.externalVisitorId);
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.sessionId, visitorId: visitor.id }
  });

  if (!conversation) {
    return { ok: false as const, status: 404, error: "Conversation not found." };
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" }
  });

  return { ok: true as const, messages };
}
