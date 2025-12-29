"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.string().optional().default("development"),
    PORT: zod_1.z.coerce.number().int().positive().default(8080),
    DATABASE_URL: zod_1.z.string().min(1),
    REDIS_URL: zod_1.z.string().min(1),
    GEMINI_API_KEY: zod_1.z.string().optional(),
    GEMINI_MODEL: zod_1.z.string().optional().default("gemini-2.5-flash"),
    RATE_LIMIT_VISITOR_PER_MINUTE: zod_1.z.coerce.number().int().positive().default(10),
    RATE_LIMIT_IP_PER_MINUTE: zod_1.z.coerce.number().int().positive().default(60),
    CACHE_TTL_SECONDS: zod_1.z.coerce.number().int().positive().default(900),
    MAX_ACTIVE_CONVERSATIONS: zod_1.z.coerce.number().int().positive().default(3),
    ACTIVE_CONVERSATION_TTL_MINUTES: zod_1.z.coerce.number().int().positive().default(1440)
});
exports.env = envSchema.parse(process.env);
