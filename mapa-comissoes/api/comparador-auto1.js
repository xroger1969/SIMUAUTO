const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";

function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function validUser(token) {
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    signal: AbortSignal.timeout(10000),
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + token }
  });
  if (!response.ok) return false;
  const membership = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_current_member", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: SUPABASE_KEY,
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "content-profile": "mapa_comercial"
    },
    body: "{}"
  });
  if (!membership.ok) return false;
  const member = await membership.json();
  return member?.active === true && member?.role === "admin";
}

function auto1Code(raw) {
  try {
    const u = new URL(raw);
    if (!/(^|\.)auto1\.com$/i.test(u.hostname)) return "";
    const m = u.pathname.match(/\/merchant\/car\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).trim() : "";
  } catch {
    return "";
  }
}

function pick(obj, paths) {
  for (const path of paths) {
    let value = obj;
    for (const key of path.split(".")) value = value?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function compact(value, depth = 0) {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) return value.slice(0, 40).map(v => compact(v, depth + 1)).filter(v => v !== undefined);
  if (!value || typeof value !== "object") return value;
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(value)) {
    if (count >= 80) break;
    if (/token|cookie|authorization|session/i.test(k)) continue;
    const c = compact(v, depth + 1);
    if (c !== undefined) { out[k] = c; count++; }
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.THECARAPI_API_KEY),
      provider: "thecarapi"
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const token = bearer(req);
  if (!token || !(await validUser(token))) return res.status(401).json({ error: "invalid_auth" });

  const url = String(req.body?.url || "").trim();
  const code = auto1Code(url);
  if (!code) return res.status(400).json({ error: "invalid_auto1_url", message: "O link AUTO1 não contém um identificador de viatura reconhecível." });

  if (!process.env.THECARAPI_API_KEY) {
    return res.status(503).json({
      error: "auto1_api_not_configured",
      message: "A leitura direta AUTO1 por API ainda não está configurada."
    });
  }

  try {
    const endpoint = "https://api.thecarapi.com/api/car-details?site=auto1&id=" + encodeURIComponent(code);
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(45000),
      headers: {
        "X-API-Key": process.env.THECARAPI_API_KEY,
        "accept": "application/json",
        "accept-encoding": "gzip"
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 202 || data?.details_pending === true) {
      return res.status(202).json({ ok: true, status: "pending", vehicle_code: code });
    }
    if (!response.ok || data?.success === false) {
      const msg = data?.message || data?.detail || data?.error || "A API AUTO1 não devolveu a ficha da viatura.";
      return res.status(response.status === 404 ? 404 : 502).json({
        error: response.status === 404 ? "auto1_vehicle_not_found" : "auto1_provider_error",
        message: String(msg)
      });
    }

    const make = pick(data, [
      "vehicle_details.make","vehicle_details.brand","vehicle_details.manufacturer",
      "clean_make","make","brand"
    ]);
    const model = pick(data, [
      "vehicle_details.model","vehicle_details.model_name","clean_model","model"
    ]);
    const trim = pick(data, [
      "vehicle_details.trim","vehicle_details.version","trim","version"
    ]);
    const year = pick(data, [
      "vehicle_details.year","vehicle_details.model_year","year"
    ]);
    const mileage = pick(data, [
      "vehicle_details.mileage","vehicle_details.mileage_km","mileage","km"
    ]);
    const price = pick(data, [
      "current_price","public_price_eur","vehicle_details.price","price"
    ]);

    const title = [make, model, trim].filter(Boolean).join(" ").trim() || ("AUTO1 " + code);
    const descBits = [];
    if (year) descBits.push(String(year));
    if (mileage) descBits.push(String(mileage) + " km");
    if (price) descBits.push(String(price) + " €");

    const safePayload = compact(data);
    let textSample = JSON.stringify({
      auto1_offer_code: code,
      source_url: url,
      normalized_hint: { make, model, trim, year, mileage_km: mileage, price_eur: price },
      provider_payload: safePayload
    });
    if (textSample.length > 14000) textSample = textSample.slice(0, 14000);

    return res.status(200).json({
      ok: true,
      status: "ok",
      vehicle_code: code,
      reader: {
        ok: true,
        status: "ok",
        source_kind: "auto1_api",
        vehicle_code: code,
        page: {
          title,
          description: descBits.join(" · ") || "Ficha AUTO1 lida por API.",
          text_sample: textSample,
          json_ld: [],
          origin_evidence: null
        }
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "auto1_api_error",
      message: String(error?.message || error)
    });
  }
};
