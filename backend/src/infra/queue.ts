import { Queue } from "bullmq";
import { redis } from "./redis";

export const chatReplyQueue = new Queue("chat-reply", {
  connection: redis
});
