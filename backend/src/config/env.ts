import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional().default("gemini-2.5-flash"),

  RATE_LIMIT_VISITOR_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_IP_PER_MINUTE: z.coerce.number().int().positive().default(60),

  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  MAX_ACTIVE_CONVERSATIONS: z.coerce.number().int().positive().default(3),
  ACTIVE_CONVERSATION_TTL_MINUTES: z.coerce.number().int().positive().default(1440)
});

export const env = envSchema.parse(process.env);
