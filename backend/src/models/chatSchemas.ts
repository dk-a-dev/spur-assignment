import { z } from "zod";

export const postMessageBodySchema = z.object({
  message: z.string(),
  sessionId: z.string().optional(),
  clientMessageId: z.string().optional(),
  async: z.boolean().optional().default(false)
});

export const historyQuerySchema = z.object({
  sessionId: z.string().min(1)
});

export const jobParamsSchema = z.object({
  jobId: z.string().min(1)
});

export const subscribeQuerySchema = z.object({
  sessionId: z.string().min(1)
});
