"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimitMiddleware = rateLimitMiddleware;
const redis_1 = require("../infra/redis");
const config_1 = require("../config");
function getClientIp(req) {
    const xff = req.header("x-forwarded-for");
    if (xff)
        return xff.split(",")[0]?.trim() || "unknown";
    return req.ip || "unknown";
}
async function fixedWindowLimit(key, limit, windowSeconds) {
    const count = await redis_1.redis.incr(key);
    if (count === 1) {
        await redis_1.redis.expire(key, windowSeconds);
    }
    return { count, allowed: count <= limit };
}
function rateLimitMiddleware() {
    return async function rateLimit(req, res, next) {
        try {
            const visitorId = req.visitor?.visitorId || "unknown";
            const ip = getClientIp(req);
            const visitorKey = `rl:visitor:${visitorId}:m`;
            const ipKey = `rl:ip:${ip}:m`;
            const [visitor, ipLimit] = await Promise.all([
                fixedWindowLimit(visitorKey, config_1.env.RATE_LIMIT_VISITOR_PER_MINUTE, 60),
                fixedWindowLimit(ipKey, config_1.env.RATE_LIMIT_IP_PER_MINUTE, 60)
            ]);
            if (!visitor.allowed || !ipLimit.allowed) {
                return res.status(429).json({
                    error: "You're sending messages too fast. Please wait a moment and try again."
                });
            }
            next();
        }
        catch {
            // If Redis is down, don't take the whole API down.
            next();
        }
    };
}
