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
    if (p[0] >= 224) return true;
    return false;
  }
  const x = ip.toLowerCase();
  return x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80:");
}

function cleanText(html) {
  return html
    .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<svg\\b[^>]*>[\\s\\S]*?<\\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\s+/g, " ")
    .trim();
}

function meta(html, name, attr) {
  const a = attr || "name";
  const safe = String(name).replace(/[.*+?^$()|[\\]{}\\\\]/g, "\\$&");
  const re1 = new RegExp("<meta[^>]*" + a + "=[\\"']" + safe + "[\\"'][^>]*content=[\\"']([^\\"']*)[\\"'][^>]*>", "i");
  const re2 = new RegExp("<meta[^>]*content=[\\"']([^\\"']*)[\\"'][^>]*" + a + "=[\\"']" + safe + "[\\"'][^>]*>", "i");
  const m = html.match(re1) || html.match(re2) || [];
  return m[1] || "";
}

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [];
  return (m[1] || "").replace(/\\s+/g, " ").trim();
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=[\\"']application\\/ld\\+json[\\"'][^>]*>([\\s\\S]*?)<\\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) out.push.apply(out, v.slice(0, 4));
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

    const resolved = await dns.lookup(host, { all: true });
    if (!resolved.length || resolved.some(x => privateIp(x.address))) {
      return res.status(400).json({ error: "private_network_not_allowed" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(target.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/154 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "pt-PT,pt;q=0.9,en;q=0.7"
        }
      });
    } finally {
      clearTimeout(timer);
    }

    const type = response.headers.get("content-type") || "";
    const rawBody = Buffer.from(await response.arrayBuffer());
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
    const sample = cleanText(html).slice(0, 15000);

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
        text_sample: sample
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
