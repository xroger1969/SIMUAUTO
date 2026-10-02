const dns = require("node:dns").promises;
const net = require("node:net");

function privateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  const x = ip.toLowerCase();
  if(x.startsWith("::ffff:"))return privateIp(x.slice(7));
  return x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80:");
}

function stripBlock(html, tag) {
  return html.replace(new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?<\\/" + tag + ">", "gi"), " ");
}

function cleanText(html) {
  let out = String(html || "");
  out = stripBlock(out, "script");
  out = stripBlock(out, "style");
  out = stripBlock(out, "svg");
  return out
    .replace(new RegExp("<[^>]+>", "g"), " ")
    .replace(new RegExp("&nbsp;", "gi"), " ")
    .replace(new RegExp("&amp;", "gi"), "&")
    .replace(new RegExp("&quot;", "gi"), '"')
    .replace(new RegExp("&#39;", "gi"), "'")
    .replace(new RegExp("\\s+", "g"), " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

function meta(html, name, attr) {
  const a = attr || "name";
  const safe = escapeRegex(name);
  const q = "[\\\"']";
  const re1 = new RegExp("<meta[^>]*" + a + "=" + q + safe + q + "[^>]*content=" + q + "([^\\\"']*)" + q + "[^>]*>", "i");
  const re2 = new RegExp("<meta[^>]*content=" + q + "([^\\\"']*)" + q + "[^>]*" + a + "=" + q + safe + q + "[^>]*>", "i");
  const m = html.match(re1) || html.match(re2) || [];
  return m[1] || "";
}

function getTitle(html) {
  const re = new RegExp("<title[^>]*>([\\s\\S]*?)<\\/title>", "i");
  const m = html.match(re) || [];
  return (m[1] || "").replace(new RegExp("\\s+", "g"), " ").trim();
}

function jsonLd(html) {
  const out = [];
  const re = new RegExp("<script[^>]+type=[\\\"']application\\/ld\\+json[\\\"'][^>]*>([\\s\\S]*?)<\\/script>", "gi");
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) out.push(...v.slice(0, 4));
      else out.push(v);
    } catch {}
  }
  return out.slice(0, 8);
}

function looksLikeLogin(url, html, status) {
  if ([401, 403].includes(status)) return true;
  const u = String(url || "").toLowerCase();
  if (u.includes("/login") || u.includes("/signin")) return true;
  const text = cleanText(html.slice(0, 180000)).toLowerCase();
  return /iniciar sessão|iniciar sessao|sign in|log in|login required|sessão necessária|sessao necessaria/.test(text)
    && /password|palavra-passe|email/.test(text);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const raw = String((req.body && req.body.url) || "").trim();
    const target = new URL(raw);
    if (!["http:", "https:"].includes(target.protocol)) return res.status(400).json({ error: "invalid_protocol" });
    if (target.username || target.password) return res.status(400).json({ error: "credentials_in_url_not_allowed" });

    const host = target.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return res.status(400).json({ error: "private_host_not_allowed" });

    if((host==="auto1.com"||host.endsWith(".auto1.com"))&&target.pathname.includes("/app/merchant/")){
      return res.status(200).json({ok:true,status:"needs_auth",source_domain:host,message:"Este anúncio de comerciante AUTO1 exige acesso autenticado. Cola os dados da viatura para continuar."});
    }
    const resolved = await dns.lookup(host, { all: true });
    if (!resolved.length || resolved.some(x => privateIp(x.address))) {
      return res.status(400).json({ error: "private_network_not_allowed" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(target.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/154 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "pt-PT,pt;q=0.9,en;q=0.7"
        }
      });
    } catch(error) {
      clearTimeout(timer);throw error;
    }
    if(response.status>=300&&response.status<400){clearTimeout(timer);return res.status(200).json({ok:false,status:"failed",message:"Este anúncio redireciona. Cola o endereço final da página."});}

    const type = response.headers.get("content-type") || "";
    let rawBody;
    try {
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>1500000){controller.abort();throw new Error("Página demasiado grande para leitura direta.");}chunks.push(Buffer.from(chunk));}
      rawBody=Buffer.concat(chunks);
    }finally{clearTimeout(timer)}
    const html = rawBody.subarray(0, 1500000).toString("utf8");
    const finalUrl = response.url || target.toString();

    if (looksLikeLogin(finalUrl, html, response.status)) {
      return res.status(200).json({
        ok: true,
        status: "needs_auth",
        source_domain: host,
        http_status: response.status,
        final_url: finalUrl,
        message: "A página exige uma sessão autenticada."
      });
    }

    if (!response.ok) {
      return res.status(200).json({
        ok: false,
        status: "failed",
        source_domain: host,
        http_status: response.status,
        final_url: finalUrl,
        message: "A origem respondeu com HTTP " + response.status + "."
      });
    }

    if (!type.includes("html") && !type.includes("json")) {
      return res.status(200).json({
        ok: false,
        status: "failed",
        source_domain: host,
        http_status: response.status,
        message: "Conteúdo não suportado."
      });
    }

    const og = {
      title: meta(html, "og:title", "property"),
      description: meta(html, "og:description", "property"),
      image: meta(html, "og:image", "property"),
      type: meta(html, "og:type", "property")
    };
    const description = meta(html, "description") || og.description;
    const fullText=cleanText(html);
    const sample = fullText.slice(0, 15000);
    const originMatch=fullText.match(/\bOrigem\s*[:—-]?\s*(Importado|Nacional)\b/i);
    const originEvidence=originMatch?{value:/importado/i.test(originMatch[1])?"imported":"national",label:originMatch[0],section:"Estado e histórico",url:finalUrl}:null;

    return res.status(200).json({
      ok: true,
      status: "ok",
      source_domain: host,
      http_status: response.status,
      final_url: finalUrl,
      page: {
        title: getTitle(html) || og.title,
        description,
        og,
        json_ld: jsonLd(html),
        text_sample: sample,
        origin_evidence: originEvidence
      }
    });
  } catch (err) {
    const code = err && err.name === "AbortError" ? "timeout" : "reader_error";
    return res.status(200).json({
      ok: false,
      status: "failed",
      error: code,
      message: String((err && err.message) || err)
    });
  }
};
