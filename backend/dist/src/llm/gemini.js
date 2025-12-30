"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReply = generateReply;
const config_1 = require("../config");
function toGeminiContents(turns) {
    return turns.map((t) => ({
        role: t.role,
        parts: [{ text: t.text }]
    }));
}
async function generateReply(params) {
    if (!config_1.env.GEMINI_API_KEY || config_1.env.GEMINI_API_KEY.trim().length === 0) {
        throw new Error("Missing GEMINI_API_KEY");
    }
    const model = config_1.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const systemInstructionText = `${params.systemPrompt}\n\nStore FAQ / Policies:\n${params.faqContext}`.trim();
    // Use systemInstruction instead of putting system prompt into a user message.
    const contents = toGeminiContents([
        ...params.history,
        { role: "user", text: params.userMessage }
    ]);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                // Put API key in header (not URL) so it never appears in error strings.
                "x-goog-api-key": config_1.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemInstructionText }]
                },
                contents,
                generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 400
                }
            }),
            signal: controller.signal
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            const truncated = text.length > 800 ? `${text.slice(0, 800)}…` : text;
            const hint = resp.status === 401 || resp.status === 403
                ? "(auth error: check GEMINI_API_KEY / model access)"
                : resp.status === 429
                    ? "(rate limited: try again / reduce traffic)"
                    : resp.status >= 500
                        ? "(provider error)"
                        : "";
            throw new Error(`Gemini API error status=${resp.status} ${hint} body=${truncated}`);
        }
        const data = (await resp.json());
        const parts = data?.candidates?.[0]?.content?.parts;
        const replyText = Array.isArray(parts)
            ? parts
                .map((p) => (typeof p?.text === "string" ? p.text : ""))
                .join("")
            : undefined;
        if (!replyText || replyText.trim().length === 0) {
            throw new Error("Empty Gemini response");
        }
        return replyText.trim();
    }
    catch (err) {
        // Log server-side for debugging (no API key in message).
        // eslint-disable-next-line no-console
        console.error("Gemini generateReply failed:", err);
        throw err;
    }
    finally {
        clearTimeout(timeout);
    }
}
