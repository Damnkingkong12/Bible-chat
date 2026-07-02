// Vercel serverless function — keeps your xAI API key secret on the server.
// Set the environment variable XAI_API_KEY in your Vercel project settings.
// Optionally set GROK_MODEL (defaults to "grok-3-mini", a low-cost model).

const SYSTEM_PROMPT = `You are "Friend in Christ", a warm, encouraging Bible companion.
You help people with questions about the Bible, scripture passages, Christian faith,
and daily encouragement. Quote scripture with book, chapter and verse (e.g. John 3:16).
Be kind, humble, and conversational. Keep answers clear and fairly concise (a few short
paragraphs at most) since they will be read aloud. Do not use markdown, bullet points,
asterisks, or headings — write in plain spoken sentences only.
If asked about things unrelated to faith or the Bible, gently steer back to your purpose.
Begin the very first reply of a conversation warmly, as a friend would.`;

// --- very simple per-IP rate limiter (best-effort on serverless) ---
const hits = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_PER_WINDOW = 12;   // 12 messages per minute per IP

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: "You're sending messages a little fast. Please wait a moment." });
  }

  if (!process.env.XAI_API_KEY) {
    return res.status(500).json({ error: "Server is missing the XAI_API_KEY setting." });
  }

  try {
    let { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "No messages provided." });
    }

    // Keep only the last 20 turns and sanitize roles/content.
    messages = messages
      .slice(-20)
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role,
        content: String(m.content || "").slice(0, 4000),
      }));

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROK_MODEL || "grok-3-mini",
        max_tokens: 700,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("xAI API error:", response.status, detail);
      return res.status(502).json({
        error:
          "Problem from the AI service (code " +
          response.status +
          "): " +
          detail.slice(0, 300),
      });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({ error: "The assistant returned an empty reply. Please try again." });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
