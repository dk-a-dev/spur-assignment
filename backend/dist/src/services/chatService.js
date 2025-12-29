"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateVisitor = getOrCreateVisitor;
exports.postUserMessage = postUserMessage;
exports.persistUserMessage = persistUserMessage;
exports.generateAndPersistAiReply = generateAndPersistAiReply;
exports.fetchConversationHistory = fetchConversationHistory;
const prisma_1 = require("../db/prisma");
const config_1 = require("../config");
const faqService_1 = require("./faqService");
const gemini_1 = require("../llm/gemini");
const redis_1 = require("../infra/redis");
const crypto_1 = require("crypto");
const SYSTEM_PROMPT = "You are a helpful support agent for a small e-commerce store. Answer clearly and concisely. If the answer is not in the provided FAQ/policies, say you are not sure and suggest contacting support.";
function clampMessageText(text) {
    const trimmed = text.trim();
    const maxLen = 2000;
    if (trimmed.length <= maxLen)
        return { text: trimmed, truncated: false };
    return { text: trimmed.slice(0, maxLen), truncated: true };
}
async function getOrCreateVisitor(externalId) {
    return prisma_1.prisma.visitor.upsert({
        where: { externalId },
        create: { externalId },
        update: {}
    });
}
async function findActiveConversations(visitorId) {
    const ttlMs = config_1.env.ACTIVE_CONVERSATION_TTL_MINUTES * 60_000;
    const since = new Date(Date.now() - ttlMs);
    return prisma_1.prisma.conversation.findMany({
        where: { visitorId, lastMessageAt: { gt: since } },
        orderBy: { lastMessageAt: "desc" },
        take: config_1.env.MAX_ACTIVE_CONVERSATIONS
    });
}
async function getOrCreateConversation(params) {
    if (params.sessionId) {
        const existing = await prisma_1.prisma.conversation.findFirst({
            where: { id: params.sessionId, visitorId: params.visitorId }
        });
        if (existing)
            return existing;
    }
    // Enforce max active conversations; if exceeded, reuse most recent.
    const active = await findActiveConversations(params.visitorId);
    if (active.length >= config_1.env.MAX_ACTIVE_CONVERSATIONS) {
        return active[0];
    }
    return prisma_1.prisma.conversation.create({
        data: {
            visitorId: params.visitorId
        }
    });
}
async function getHistory(conversationId) {
    const messages = await prisma_1.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" }
    });
    // Keep context small for cost control: last 20 turns.
    const recent = messages.slice(Math.max(0, messages.length - 20));
    const history = recent
        .filter((m) => m.sender === "user" || m.sender === "ai")
        .map((m) => ({
        role: m.sender === "user" ? "user" : "model",
        text: m.text
    }));
    return { messages, history };
}
function normalizeForCache(text) {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}
function sha256(text) {
    return (0, crypto_1.createHash)("sha256").update(text).digest("hex");
}
async function postUserMessage(params) {
    const { text, truncated } = clampMessageText(params.message);
    if (text.length === 0) {
        return {
            ok: false,
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
        await prisma_1.prisma.message.create({
            data: {
                conversationId: conversation.id,
                sender: "user",
                text,
                clientMessageId: params.clientMessageId
            }
        });
    }
    catch (e) {
        // Idempotency: if same clientMessageId was already stored, continue.
        // Prisma unique constraint violation code is P2002.
        if (e?.code !== "P2002")
            throw e;
    }
    await prisma_1.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
    });
    const faqContext = await (0, faqService_1.getFaqContext)();
    const { history } = await getHistory(conversation.id);
    // Cache only for "low-context" questions (e.g., first user message)
    // to avoid serving context-dependent answers incorrectly.
    const canUseCache = history.length <= 2;
    const cacheKey = canUseCache
        ? `cache:reply:${config_1.env.GEMINI_MODEL}:${sha256(faqContext)}:${sha256(normalizeForCache(text))}`
        : null;
    if (cacheKey) {
        try {
            const cached = await redis_1.redis.get(cacheKey);
            if (cached && cached.trim().length > 0) {
                await prisma_1.prisma.message.create({
                    data: {
                        conversationId: conversation.id,
                        sender: "ai",
                        text: truncated
                            ? `${cached}\n\n(Note: Your message was truncated to 2000 characters.)`
                            : cached
                    }
                });
                await prisma_1.prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { lastMessageAt: new Date() }
                });
                return {
                    ok: true,
                    sessionId: conversation.id,
                    reply: cached
                };
            }
        }
        catch {
            // Cache is best-effort.
        }
    }
    let reply;
    try {
        reply = await (0, gemini_1.generateReply)({
            systemPrompt: SYSTEM_PROMPT,
            faqContext,
            history,
            userMessage: text
        });
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.error("LLM failed for sync message:", e);
        reply =
            "Sorry — I’m having trouble reaching the support agent brain right now. Please try again in a moment.";
    }
    if (cacheKey) {
        try {
            await redis_1.redis.set(cacheKey, reply, "EX", config_1.env.CACHE_TTL_SECONDS);
        }
        catch {
            // ignore
        }
    }
    await prisma_1.prisma.message.create({
        data: {
            conversationId: conversation.id,
            sender: "ai",
            text: truncated
                ? `${reply}\n\n(Note: Your message was truncated to 2000 characters.)`
                : reply
        }
    });
    await prisma_1.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
    });
    return {
        ok: true,
        sessionId: conversation.id,
        reply
    };
}
async function persistUserMessage(params) {
    const { text, truncated } = clampMessageText(params.message);
    if (text.length === 0) {
        return {
            ok: false,
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
        await prisma_1.prisma.message.create({
            data: {
                conversationId: conversation.id,
                sender: "user",
                text,
                clientMessageId: params.clientMessageId
            }
        });
    }
    catch (e) {
        if (e?.code !== "P2002")
            throw e;
    }
    await prisma_1.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
    });
    return {
        ok: true,
        sessionId: conversation.id,
        normalizedText: text,
        truncated
    };
}
async function generateAndPersistAiReply(params) {
    const faqContext = await (0, faqService_1.getFaqContext)();
    const { history } = await getHistory(params.conversationId);
    const canUseCache = history.length <= 2;
    const cacheKey = canUseCache
        ? `cache:reply:${config_1.env.GEMINI_MODEL}:${sha256(faqContext)}:${sha256(normalizeForCache(params.userMessage))}`
        : null;
    if (cacheKey) {
        try {
            const cached = await redis_1.redis.get(cacheKey);
            if (cached && cached.trim().length > 0) {
                await prisma_1.prisma.message.create({
                    data: {
                        conversationId: params.conversationId,
                        sender: "ai",
                        text: params.truncated
                            ? `${cached}\n\n(Note: Your message was truncated to 2000 characters.)`
                            : cached
                    }
                });
                await prisma_1.prisma.conversation.update({
                    where: { id: params.conversationId },
                    data: { lastMessageAt: new Date() }
                });
                return { reply: cached, fromCache: true };
            }
        }
        catch {
            // ignore
        }
    }
    let reply;
    try {
        reply = await (0, gemini_1.generateReply)({
            systemPrompt: SYSTEM_PROMPT,
            faqContext,
            history,
            userMessage: params.userMessage
        });
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.error("LLM failed for async job:", e);
        reply =
            "Sorry — I’m having trouble reaching the support agent brain right now. Please try again in a moment.";
    }
    if (cacheKey) {
        try {
            await redis_1.redis.set(cacheKey, reply, "EX", config_1.env.CACHE_TTL_SECONDS);
        }
        catch {
            // ignore
        }
    }
    await prisma_1.prisma.message.create({
        data: {
            conversationId: params.conversationId,
            sender: "ai",
            text: params.truncated
                ? `${reply}\n\n(Note: Your message was truncated to 2000 characters.)`
                : reply
        }
    });
    await prisma_1.prisma.conversation.update({
        where: { id: params.conversationId },
        data: { lastMessageAt: new Date() }
    });
    return { reply, fromCache: false };
}
async function fetchConversationHistory(params) {
    const visitor = await getOrCreateVisitor(params.externalVisitorId);
    const conversation = await prisma_1.prisma.conversation.findFirst({
        where: { id: params.sessionId, visitorId: visitor.id }
    });
    if (!conversation) {
        return { ok: false, status: 404, error: "Conversation not found." };
    }
    const messages = await prisma_1.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" }
    });
    return { ok: true, messages };
}
