import "dotenv/config";
import { prisma } from "../src/db/prisma";

async function main() {
  const faqs = [
    {
      slug: "shipping-policy",
      title: "Shipping policy",
      content:
        "We ship across India and to the USA. India delivery usually takes 3–5 business days. USA delivery usually takes 7–12 business days. Shipping is free on orders above ₹999; otherwise a flat ₹79 fee applies."
    },
    {
      slug: "return-policy",
      title: "Return and refund policy",
      content:
        "You can return products within 7 days of delivery if unused and in original packaging. Refunds are processed to the original payment method within 5–7 business days after pickup/inspection."
    },
    {
      slug: "support-hours",
      title: "Support hours",
      content:
        "Support is available Monday to Saturday, 10:00 AM to 7:00 PM IST. We reply within 2–4 hours during support hours."
    }
  ];

  for (const faq of faqs) {
    await prisma.faqEntry.upsert({
      where: { slug: faq.slug },
      create: faq,
      update: {
        title: faq.title,
        content: faq.content
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
