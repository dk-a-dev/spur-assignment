"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeQuerySchema = exports.jobParamsSchema = exports.historyQuerySchema = exports.postMessageBodySchema = void 0;
const zod_1 = require("zod");
exports.postMessageBodySchema = zod_1.z.object({
    message: zod_1.z.string(),
    sessionId: zod_1.z.string().optional(),
    clientMessageId: zod_1.z.string().optional(),
    async: zod_1.z.boolean().optional().default(false)
});
exports.historyQuerySchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1)
});
exports.jobParamsSchema = zod_1.z.object({
    jobId: zod_1.z.string().min(1)
});
exports.subscribeQuerySchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1)
});
