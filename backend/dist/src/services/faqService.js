"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFaqContext = getFaqContext;
const prisma_1 = require("../db/prisma");
async function getFaqContext() {
    const faqs = await prisma_1.prisma.faqEntry.findMany({ orderBy: { slug: "asc" } });
    if (faqs.length === 0)
        return "(No FAQ entries found.)";
    return faqs
        .map((f) => `- ${f.title}\n${f.content}`)
        .join("\n\n")
        .trim();
}
