"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bullmq_1 = require("bullmq");
const redis_1 = require("./infra/redis");
const chatService_1 = require("./services/chatService");
const connection = redis_1.redis;
new bullmq_1.Worker("chat-reply", async (job) => {
    const data = job.data;
    const result = await (0, chatService_1.generateAndPersistAiReply)({
        conversationId: data.conversationId,
        userMessage: data.userMessage,
        truncated: data.truncated
    });
    try {
        await redis_1.redis.publish(`conversation:${data.conversationId}`, JSON.stringify({
            type: "ai",
            conversationId: data.conversationId,
            reply: result.reply,
            fromCache: result.fromCache
        }));
    }
    catch {
        // best-effort
    }
    return { ok: true };
}, {
    connection,
    concurrency: 10
});
// eslint-disable-next-line no-console
console.log("Worker running");
