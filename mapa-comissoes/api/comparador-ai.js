module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "openai_not_configured" });

  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "empty_message" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + process.env.OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      store: false,
      instructions: "Responde em português de Portugal como consultor profissional de compra automóvel. Sê conciso, crítico e não inventes dados.",
      input: message,
      max_output_tokens: 500
    })
  });

  const data = await response.json();
  if (!response.ok) return res.status(502).json({ error: "openai_error", message: data?.error?.message || "Falha OpenAI" });
  return res.status(200).json({ ok: true, reply: data.output_text || "" });
};