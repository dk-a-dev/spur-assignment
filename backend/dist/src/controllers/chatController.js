"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postMessage = postMessage;
exports.getHistory = getHistory;
exports.getJob = getJob;
exports.subscribe = subscribe;
const queue_1 = require("../infra/queue");
const redis_1 = require("../infra/redis");
const chatService_1 = require("../services/chatService");
const chatSchemas_1 = require("../models/chatSchemas");
async function postMessage(req, res, next) {
    try {
        const body = chatSchemas_1.postMessageBodySchema.parse(req.body);
        const visitorId = req.visitor?.visitorId;
        if (!visitorId) {
            return res.status(500).json({ error: "Missing visitor context" });
        }
        if (body.async) {
            const persisted = await (0, chatService_1.persistUserMessage)({
                externalVisitorId: visitorId,
                message: body.message,
                sessionId: body.sessionId,
                clientMessageId: body.clientMessageId
            });
            if (!persisted.ok) {
                return res.status(persisted.status).json({ error: persisted.error });
            }
            const job = await queue_1.chatReplyQueue.add("generate", {
                conversationId: persisted.sessionId,
                userMessage: persisted.normalizedText,
                truncated: persisted.truncated
            }, {
                removeOnComplete: { age: 3600 },
                removeOnFail: 100
            });
            return res.json({
                sessionId: persisted.sessionId,
                status: "queued",
                jobId: job.id
            });
        }
        const result = await (0, chatService_1.postUserMessage)({
            externalVisitorId: visitorId,
            message: body.message,
            sessionId: body.sessionId,
            clientMessageId: body.clientMessageId
        });
        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }
        return res.json({ reply: result.reply, sessionId: result.sessionId });
    }
    catch (e) {
        next(e);
    }
}
async function getHistory(req, res, next) {
    try {
        const { sessionId } = chatSchemas_1.historyQuerySchema.parse(req.query);
        const visitorId = req.visitor?.visitorId;
        if (!visitorId) {
            return res.status(500).json({ error: "Missing visitor context" });
        }
        const result = await (0, chatService_1.fetchConversationHistory)({
            externalVisitorId: visitorId,
            sessionId
        });
        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }
        return res.json({ messages: result.messages });
    }
    catch (e) {
        next(e);
    }
}
async function getJob(req, res, next) {
    try {
        const { jobId } = chatSchemas_1.jobParamsSchema.parse(req.params);
        const job = await queue_1.chatReplyQueue.getJob(jobId);
        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }
        const state = await job.getState();
        return res.json({ jobId, state });
    }
    catch (e) {
        next(e);
    }
}
async function subscribe(req, res, next) {
    try {
        const { sessionId } = chatSchemas_1.subscribeQuerySchema.parse(req.query);
        const visitorId = req.visitor?.visitorId;
        if (!visitorId) {
            return res.status(500).json({ error: "Missing visitor context" });
        }
        const historyCheck = await (0, chatService_1.fetchConversationHistory)({
            externalVisitorId: visitorId,
            sessionId
        });
        if (!historyCheck.ok) {
            return res.status(historyCheck.status).json({ error: historyCheck.error });
        }
        res.status(200);
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache");
        res.setHeader("connection", "keep-alive");
        res.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);
        const channel = `conversation:${sessionId}`;
        const sub = redis_1.redis.duplicate();
        const cleanup = async () => {
            try {
                sub.removeAllListeners();
                await sub.unsubscribe(channel);
                sub.disconnect();
            }
            catch {
                // ignore
            }
        };
        req.on("close", cleanup);
        sub.on("message", (_channel, message) => {
            res.write(`event: update\ndata: ${message}\n\n`);
        });
        await sub.subscribe(channel);
    }
    catch (e) {
        next(e);
    }
}
