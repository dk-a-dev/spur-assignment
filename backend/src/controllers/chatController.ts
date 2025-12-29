import type { Request, Response, NextFunction } from "express";
import { chatReplyQueue } from "../infra/queue";
import { redis } from "../infra/redis";
import {
  fetchConversationHistory,
  persistUserMessage,
  postUserMessage
} from "../services/chatService";
import {
  historyQuerySchema,
  jobParamsSchema,
  postMessageBodySchema,
  subscribeQuerySchema
} from "../models/chatSchemas";

export async function postMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const body = postMessageBodySchema.parse(req.body);
    const visitorId = req.visitor?.visitorId;

    if (!visitorId) {
      return res.status(500).json({ error: "Missing visitor context" });
    }

    if (body.async) {
      const persisted = await persistUserMessage({
        externalVisitorId: visitorId,
        message: body.message,
        sessionId: body.sessionId,
        clientMessageId: body.clientMessageId
      });

      if (!persisted.ok) {
        return res.status(persisted.status).json({ error: persisted.error });
      }

      const job = await chatReplyQueue.add(
        "generate",
        {
          conversationId: persisted.sessionId,
          userMessage: persisted.normalizedText,
          truncated: persisted.truncated
        },
        {
          removeOnComplete: { age: 3600 },
          removeOnFail: 100
        }
      );

      return res.json({
        sessionId: persisted.sessionId,
        status: "queued",
        jobId: job.id
      });
    }

    const result = await postUserMessage({
      externalVisitorId: visitorId,
      message: body.message,
      sessionId: body.sessionId,
      clientMessageId: body.clientMessageId
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ reply: result.reply, sessionId: result.sessionId });
  } catch (e) {
    next(e);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionId } = historyQuerySchema.parse(req.query);
    const visitorId = req.visitor?.visitorId;

    if (!visitorId) {
      return res.status(500).json({ error: "Missing visitor context" });
    }

    const result = await fetchConversationHistory({
      externalVisitorId: visitorId,
      sessionId
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ messages: result.messages });
  } catch (e) {
    next(e);
  }
}

export async function getJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { jobId } = jobParamsSchema.parse(req.params);

    const job = await chatReplyQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();
    return res.json({ jobId, state });
  } catch (e) {
    next(e);
  }
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionId } = subscribeQuerySchema.parse(req.query);
    const visitorId = req.visitor?.visitorId;

    if (!visitorId) {
      return res.status(500).json({ error: "Missing visitor context" });
    }

    const historyCheck = await fetchConversationHistory({
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
    const sub = redis.duplicate();

    const cleanup = async () => {
      try {
        sub.removeAllListeners();
        await sub.unsubscribe(channel);
        sub.disconnect();
      } catch {
        // ignore
      }
    };

    req.on("close", cleanup);

    sub.on("message", (_channel, message) => {
      res.write(`event: update\ndata: ${message}\n\n`);
    });

    await sub.subscribe(channel);
  } catch (e) {
    next(e);
  }
}
