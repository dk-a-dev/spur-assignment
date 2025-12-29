import { prisma } from "../db/prisma";

export async function getFaqContext(): Promise<string> {
  const faqs = await prisma.faqEntry.findMany({ orderBy: { slug: "asc" } });
  if (faqs.length === 0) return "(No FAQ entries found.)";

  return faqs
    .map((f) => `- ${f.title}\n${f.content}`)
    .join("\n\n")
    .trim();
}
