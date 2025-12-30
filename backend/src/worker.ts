import "dotenv/config";
import { Worker } from "bullmq";
import { redis } from "./infra/redis";
import { generateAndPersistAiReply } from "./services/chatService";

type ChatReplyJob = {
  conversationId: string;
  userMessage: string;
  truncated: boolean;
};

const connection = redis;

new Worker(
  "chat-reply",
  async (job) => {
    const data = job.data as ChatReplyJob;

    const result = await generateAndPersistAiReply({
      conversationId: data.conversationId,
      userMessage: data.userMessage,
      truncated: data.truncated
    });

    try {
      await redis.publish(
        `conversation:${data.conversationId}`,
        JSON.stringify({
          type: "ai",
          conversationId: data.conversationId,
          reply: result.reply,
          fromCache: result.fromCache
        })
      );
    } catch {
      // best-effort
    }

    return { ok: true };
  },
  {
    connection,
    concurrency: 10
  }
);

console.log("Worker running");
