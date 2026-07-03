// Community boards (testimonies + prayer requests).
// Stores posts in the free Redis database you connect through
// Vercel's Storage tab (Upstash Redis / Vercel KV). When connected,
// Vercel adds the connection settings automatically.

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

// --- blocked words (vulgar / abusive; English + Filipino). Kept simple on purpose. ---
const BLOCKED = [
  "fuck", "fucking", "fuk", "shit", "bitch", "asshole", "bastard", "dick",
  "pussy", "cunt", "whore", "slut", "nigger", "nigga", "faggot", "fag",
  "motherfucker", "cock", "wanker", "twat", "prick", "douche",
  "putangina", "putang ina", "tangina", "tang ina", "puta", "gago", "gaga",
  "ulol", "tarantado", "punyeta", "leche", "bwisit", "hayop ka", "pakyu",
  "kingina", "pucha", "hindot", "iyot", "kantot", "burat", "titi", "pekpek",
  "bobo mo", "tanga mo"
];

function hasBlockedWord(text) {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ") + " ";
  const squished = text.toLowerCase().replace(/[^a-z0-9ñ]+/g, "");
  return BLOCKED.some((w) => {
    const clean = w.replace(/\s+/g, " ");
    return t.includes(" " + clean + " ") || squished.includes(clean.replace(/\s+/g, ""));
  });
}

// --- simple per-IP rate limiting (best-effort) ---
const hits = new Map();
function rateLimited(ip, key, max, windowMs) {
  const now = Date.now();
  const k = ip + ":" + key;
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  hits.set(k, arr);
  return false;
}

// --- talk to the database ---
async function redis(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + REST_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error("db " + res.status + ": " + (await res.text()).slice(0, 200));
  const data = await res.json();
  return data.result;
}

function boardKey(type) { return "board:" + type; }
function likesKey(type) { return "likes:" + type; }

export default async function handler(req, res) {
  if (!REST_URL || !REST_TOKEN) {
    return res.status(500).json({
      error:
        "The community board database isn't connected yet. In Vercel: Storage tab → Create Database → Upstash Redis → connect to this project, then Redeploy.",
    });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const type = (req.method === "GET" ? req.query.type : req.body?.type) || "";
  if (type !== "testimony" && type !== "prayer") {
    return res.status(400).json({ error: "Unknown board." });
  }

  try {
    // ---------- READ posts ----------
    if (req.method === "GET") {
      if (rateLimited(ip, "read", 30, 60 * 1000)) {
        return res.status(429).json({ error: "Please slow down a moment." });
      }
      const [postsRaw, likesRaw] = await Promise.all([
        redis(["HGETALL", boardKey(type)]),
        redis(["HGETALL", likesKey(type)]),
      ]);

      // HGETALL returns a flat [field, value, field, value...] array
      const likes = {};
      for (let i = 0; i < (likesRaw || []).length; i += 2) {
        likes[likesRaw[i]] = parseInt(likesRaw[i + 1], 10) || 0;
      }
      const posts = [];
      for (let i = 0; i < (postsRaw || []).length; i += 2) {
        try {
          const p = JSON.parse(postsRaw[i + 1]);
          p.id = postsRaw[i];
          p.likes = likes[p.id] || 0;
          posts.push(p);
        } catch {}
      }
      posts.sort((a, b) => b.ts - a.ts);
      return res.status(200).json({ posts: posts.slice(0, 100) });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { action } = req.body || {};

    // ---------- LIKE a post ----------
    if (action === "like") {
      if (rateLimited(ip, "like", 20, 60 * 1000)) {
        return res.status(429).json({ error: "Please slow down a moment." });
      }
      const id = String(req.body.id || "").slice(0, 40);
      if (!id) return res.status(400).json({ error: "Missing post." });
      const exists = await redis(["HEXISTS", boardKey(type), id]);
      if (!exists) return res.status(404).json({ error: "Post not found." });
      const likes = await redis(["HINCRBY", likesKey(type), id, 1]);
      return res.status(200).json({ likes });
    }

    // ---------- CREATE a post ----------
    // Bot trap: real people never see this hidden field.
    if (req.body.website) {
      return res.status(200).json({ ok: true }); // silently ignore bots
    }
    if (rateLimited(ip, "post", 3, 10 * 60 * 1000)) {
      return res
        .status(429)
        .json({ error: "You're posting quickly — please wait a few minutes and try again." });
    }

    let name = String(req.body.name || "").trim().slice(0, 15);
    let text = String(req.body.text || "").trim().slice(0, 150);

    if (name.length < 2) return res.status(400).json({ error: "Please enter a name (2–15 characters)." });
    if (text.length < 5) return res.status(400).json({ error: "Please write a little more (5–150 characters)." });
    if (hasBlockedWord(name) || hasBlockedWord(text)) {
      return res
        .status(400)
        .json({ error: "Your message contains words that aren't allowed here. Please keep it kind. 🙏" });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const post = { name, text, ts: Date.now() };
    await redis(["HSET", boardKey(type), id, JSON.stringify(post)]);

    // keep boards from growing forever: trim oldest past 300 posts
    const count = await redis(["HLEN", boardKey(type)]);
    if (count > 300) {
      const all = await redis(["HGETALL", boardKey(type)]);
      const entries = [];
      for (let i = 0; i < all.length; i += 2) {
        try { entries.push([all[i], JSON.parse(all[i + 1]).ts || 0]); } catch {}
      }
      entries.sort((a, b) => a[1] - b[1]);
      const remove = entries.slice(0, count - 300).map((e) => e[0]);
      if (remove.length) {
        await redis(["HDEL", boardKey(type), ...remove]);
        await redis(["HDEL", likesKey(type), ...remove]);
      }
    }

    post.id = id;
    post.likes = 0;
    return res.status(200).json({ ok: true, post });
  } catch (err) {
    console.error("Board error:", err);
    return res.status(500).json({ error: "The board is having trouble right now. Please try again shortly." });
  }
}
