/**
 * Baseline AI proxy.
 * Holds the OpenRouter key server-side (env: OPENROUTER_API_KEY) and grounds
 * the model in the data the frontend sends. The browser never sees the key.
 */
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());                 // tighten to your site origin in production
app.use(express.json({ limit: "1mb" }));

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const PORT = process.env.PORT || 4000;

app.get("/", (_req, res) => res.json({ ok: true, service: "baseline-api", model: MODEL, keyConfigured: !!KEY }));
app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL, keyConfigured: !!KEY }));

app.post("/api/chat", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "OPENROUTER_API_KEY not set on the server" });
  const { question, context = {}, role = "exec", history = [] } = req.body || {};
  if (!question) return res.status(400).json({ error: "question is required" });

  const sys = [
    "You are Baseline AI, the inventory-intelligence assistant for Tennis Outlet, a 6-store racquet-sports retailer (currency INR, ₹).",
    `You are answering for the ${role} view. Adapt depth: CEO/CXO = crisp, money + one risk; procurement = specific SKUs, quantities, suppliers; store team = plain, operational.`,
    "Ground EVERY answer ONLY in the DATA below. Never invent SKUs, numbers, or suppliers. If the data doesn't cover it, say so briefly.",
    "Catalog is live from Magento; stock and sales are modeled (say so if asked about data accuracy).",
    "Be concise: 2–5 sentences. Use ₹ and round numbers. No markdown headings.",
    "DATA:\n" + JSON.stringify(context).slice(0, 12000),
  ].join("\n");

  const messages = [
    { role: "system", content: sys },
    ...history.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.text || "").slice(0, 1500) })),
    { role: "user", content: String(question).slice(0, 2000) },
  ];

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://baseline-dashboard.onrender.com",
        "X-Title": "Baseline - Tennis Outlet",
      },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 600, temperature: 0.3 }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "LLM upstream error", status: r.status, detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "(no answer)";
    res.json({ answer, model: data?.model || MODEL, usage: data?.usage });
  } catch (e) {
    res.status(500).json({ error: "proxy failure", detail: String(e).slice(0, 200) });
  }
});

app.listen(PORT, () => console.log(`baseline-api on :${PORT} · model ${MODEL} · key ${KEY ? "set" : "MISSING"}`));
