"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const visitor_1 = require("./middleware/visitor");
const chatRoutes_1 = require("./routes/chatRoutes");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: "1mb" }));
    app.use((0, cookie_parser_1.default)());
    app.use(visitor_1.visitorMiddleware);
    app.get("/health", (_req, res) => {
        res.json({ "status": "ok" });
    });
    app.use("/chat", chatRoutes_1.chatRouter);
    app.use((err, _req, res, _next) => {
        const status = typeof err?.status === "number" ? err.status : 500;
        if (err?.name === "ZodError") {
            return res.status(400).json({ error: "Invalid request", details: err.errors });
        }
        if (status >= 500) {
            return res.status(500).json({ error: "Internal server error" });
        }
        return res.status(status).json({ error: err?.message ?? "Request failed" });
    });
    return app;
}
