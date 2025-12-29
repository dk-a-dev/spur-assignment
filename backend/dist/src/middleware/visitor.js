"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitorMiddleware = visitorMiddleware;
const crypto_1 = require("crypto");
const VISITOR_HEADER = "x-visitor-id";
const VISITOR_COOKIE = "vid";
function visitorMiddleware(req, res, next) {
    const headerVisitorId = req.header(VISITOR_HEADER);
    const cookieVisitorId = req.cookies?.[VISITOR_COOKIE];
    const visitorId = (headerVisitorId && headerVisitorId.trim()) || "";
    const fromCookie = (cookieVisitorId && cookieVisitorId.trim()) || "";
    const effectiveVisitorId = visitorId.length > 0 ? visitorId : fromCookie.length > 0 ? fromCookie : (0, crypto_1.randomUUID)();
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
