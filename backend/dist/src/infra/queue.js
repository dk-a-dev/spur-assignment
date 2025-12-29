"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatReplyQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("./redis");
exports.chatReplyQueue = new bullmq_1.Queue("chat-reply", {
    connection: redis_1.redis
});
