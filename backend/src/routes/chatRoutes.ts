import { Router } from "express";
import { rateLimitMiddleware } from "../middleware/rateLimit";
import { getHistory, getJob, postMessage, subscribe } from "../controllers/chatController";

export const chatRouter = Router();

chatRouter.post("/message", rateLimitMiddleware(), postMessage);
chatRouter.get("/job/:jobId", getJob);
chatRouter.get("/subscribe", subscribe);
chatRouter.get("/history", getHistory);
