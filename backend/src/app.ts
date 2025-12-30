import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { visitorMiddleware } from "./middleware/visitor";
import { chatRouter } from "./routes/chatRoutes";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use(visitorMiddleware);

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ "status": "ok" });
  });

  app.use("/chat", chatRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err?.status === "number" ? err.status : 500;

    console.error("[ERROR]", {
      status,
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      details: err?.errors
    });

    if (err?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }

    if (status >= 500) {
      return res.status(500).json({ error: "Internal server error", debug: err?.message });
    }

    return res.status(status).json({ error: err?.message ?? "Request failed" });
  });

  return app;
}
