import { defineConfig } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});
