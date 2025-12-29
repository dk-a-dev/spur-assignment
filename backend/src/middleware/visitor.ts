import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export type VisitorContext = {
  visitorId: string;
};

declare module "express-serve-static-core" {
  interface Request {
    visitor?: VisitorContext;
  }
}

const VISITOR_HEADER = "x-visitor-id";
const VISITOR_COOKIE = "vid";

export function visitorMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerVisitorId = req.header(VISITOR_HEADER);
  const cookieVisitorId = (req as any).cookies?.[VISITOR_COOKIE] as string | undefined;

  const visitorId = (headerVisitorId && headerVisitorId.trim()) || "";
  const fromCookie = (cookieVisitorId && cookieVisitorId.trim()) || "";

  const effectiveVisitorId =
    visitorId.length > 0 ? visitorId : fromCookie.length > 0 ? fromCookie : randomUUID();

  req.visitor = { visitorId: effectiveVisitorId };
  res.setHeader(VISITOR_HEADER, effectiveVisitorId);

  // Helps EventSource/SSE clients that cannot set custom headers.
  if (!fromCookie || fromCookie !== effectiveVisitorId) {
    res.cookie(VISITOR_COOKIE, effectiveVisitorId, {
      httpOnly: true,
      sameSite: "lax"
    });
  }

  next();
}
