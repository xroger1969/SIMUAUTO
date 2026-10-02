const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";

function outputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

async function validUser(token) {
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: "Bearer " + token
    }
  });
  return response.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader("cache-control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-6-astra",
      api: "responses"
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "openai_not_configured" });

  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !(await validUser(token))) return res.status(401).json({ error: "invalid_auth" });

  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "empty_message" });
  if (message.length > 4000) return res.status(400).json({ error: "message_too_long" });

  const context = req.body?.context || {};
  const contextJson = JSON.stringify(context).slice(0, 18000);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["reply", "should_save_memory", "memory_rule"],
    properties: {
      reply: { type: "string" },
      should_save_memory: { type: "boolean" },
      memory_rule: {
        type: "object",
        additionalProperties: false,
        required: ["rule_type", "statement", "confidence", "scope", "effect"],
        properties: {
          rule_type: {
            type: "string",
            enum: ["liquidity", "technical_risk", "commercial_preference", "margin_cost", "none"]
          },
          statement: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          scope: {
            type: "object",
            additionalProperties: false,
            required: ["make", "model", "trim", "year_min", "year_max", "mileage_min", "mileage_max"],
            properties: {
              make: { type: ["string", "null"] },
              model: { type: ["string", "null"] },
              trim: { type: ["string", "null"] },
              year_min: { type: ["integer", "null"] },
              year_max: { type: ["integer", "null"] },
              mileage_min: { type: ["integer", "null"] },
              mileage_max: { type: ["integer", "null"] }
            }
          },
          effect: {
            type: "object",
            additionalProperties: false,
            required: ["mode", "liquidity_bias", "risk_reserve_eur", "margin_delta_eur", "note"],
            properties: {
              mode: { type: "string", enum: ["advisory"] },
              liquidity_bias: { type: "integer", minimum: -2, maximum: 2 },
              risk_reserve_eur: { type: "number", minimum: 0, maximum: 10000 },
              margin_delta_eur: { type: "number", minimum: -10000, maximum: 10000 },
              note: { type: "string" }
            }
          }
        }
      }
    }
  };

  const instructions = [
    "És o Comprador IA do Comparador Auto Pro para comerciantes profissionais de automóveis usados em Portugal.",
    "Responde em português de Portugal, de forma curta, comercial e objetiva.",
    "Não concordes automaticamente com o utilizador e nunca inventes preços, procura, avarias, equipamento ou comparáveis.",
    "Distingue factos do mercado, observações do comerciante e inferências.",
    "Se o comerciante ensinar algo reutilizável, cria uma memória estruturada com confiança moderada. Uma observação isolada nunca deve alterar cegamente o preço de mercado.",
    "Liquidez influencia rotação e risco; riscos técnicos influenciam reserva; margem/custos influenciam o cálculo comercial.",
    "Se for apenas uma pergunta sobre a compra atual, responde sem criar memória.",
    "Se faltarem dados, explica exatamente o que falta."
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-astra",
        store: false,
        instructions,
        input: "CONTEXTO:\n" + contextJson + "\n\nMENSAGEM DO COMERCIANTE:\n" + message,
        text: {
          format: {
            type: "json_schema",
            name: "comparador_auto_pro_reply",
            strict: true,
            schema
          },
          verbosity: "low"
        },
        max_output_tokens: 700
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({
        error: "openai_error",
        message: data?.error?.message || "Falha ao contactar a OpenAI."
      });
    }

    const text = outputText(data);
    const parsed = JSON.parse(text);

    if (!parsed.should_save_memory) {
      parsed.memory_rule = {
        rule_type: "none",
        statement: "",
        confidence: 0,
        scope: { make: null, model: null, trim: null, year_min: null, year_max: null, mileage_min: null, mileage_max: null },
        effect: { mode: "advisory", liquidity_bias: 0, risk_reserve_eur: 0, margin_delta_eur: 0, note: "" }
      };
    }

    return res.status(200).json({
      ok: true,
      model: data.model || process.env.OPENAI_MODEL || "gpt-6-astra",
      usage: data.usage || null,
      ...parsed
    });
  } catch (error) {
    return res.status(500).json({
      error: "server_error",
      message: String(error?.message || error)
    });
  }
};
