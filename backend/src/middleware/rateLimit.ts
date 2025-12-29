import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis";
import { env } from "../config";

function getClientIp(req: Request): string {
  const xff = req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.ip || "unknown";
}

async function fixedWindowLimit(key: string, limit: number, windowSeconds: number) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return { count, allowed: count <= limit };
}

export function rateLimitMiddleware() {
  return async function rateLimit(req: Request, res: Response, next: NextFunction) {
    try {
      const visitorId = req.visitor?.visitorId || "unknown";
      const ip = getClientIp(req);

      const visitorKey = `rl:visitor:${visitorId}:m`;
      const ipKey = `rl:ip:${ip}:m`;

      const [visitor, ipLimit] = await Promise.all([
        fixedWindowLimit(visitorKey, env.RATE_LIMIT_VISITOR_PER_MINUTE, 60),
        fixedWindowLimit(ipKey, env.RATE_LIMIT_IP_PER_MINUTE, 60)
      ]);

      if (!visitor.allowed || !ipLimit.allowed) {
        return res.status(429).json({
          error: "You're sending messages too fast. Please wait a moment and try again."
        });
      }

      next();
    } catch {
      // If Redis is down, don't take the whole API down.
      next();
    }
  };
}
