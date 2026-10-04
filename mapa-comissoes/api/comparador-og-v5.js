const sharp = require('sharp');

module.exports = async function handler(req, res) {
  const svg = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#06131f"/>
        <stop offset="58%" stop-color="#0d2942"/>
        <stop offset="100%" stop-color="#dcecf1"/>
      </linearGradient>
      <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#9cf0d2"/>
        <stop offset="100%" stop-color="#35e6a5"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#00111c" flood-opacity=".26"/>
      </filter>
    </defs>

    <rect width="1200" height="630" fill="url(#bg)"/>
    <circle cx="1120" cy="20" r="260" fill="#35e6a5" opacity=".10"/>
    <circle cx="0" cy="650" r="290" fill="#ffffff" opacity=".045"/>

    <g transform="translate(64 58)">
      <circle cx="41" cy="41" r="36" fill="none" stroke="#f7fbfc" stroke-width="10"/>
      <line x1="42" y1="43" x2="69" y2="21" stroke="#35e6a5" stroke-width="10" stroke-linecap="round"/>
      <circle cx="42" cy="43" r="7" fill="#35e6a5"/>

      <text x="104" y="42" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="54" font-weight="800">Comparador</text>
      <text x="104" y="98" fill="#35e6a5" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="800">Auto Pro</text>
    </g>

    <text x="64" y="252" fill="#eff6f8" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="700">
      Avalie viaturas com rapidez
    </text>
    <text x="64" y="292" fill="#eff6f8" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="700">
      e inteligência.
    </text>
    <text x="64" y="342" fill="#b5c8d2" font-family="Arial,Helvetica,sans-serif" font-size="20">
      Preço de mercado, compra ideal e venda rápida
    </text>
    <text x="64" y="370" fill="#b5c8d2" font-family="Arial,Helvetica,sans-serif" font-size="20">
      numa só análise.
    </text>

    <g font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="700">
      <rect x="64" y="512" width="118" height="38" rx="19" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".18"/>
      <text x="83" y="537" fill="#dbe8ee">Análise IA</text>
      <rect x="194" y="512" width="178" height="38" rx="19" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".18"/>
      <text x="213" y="537" fill="#dbe8ee">Mercado profissional</text>
      <rect x="384" y="512" width="165" height="38" rx="19" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".18"/>
      <text x="403" y="537" fill="#dbe8ee">Decisão de compra</text>
    </g>

    <g filter="url(#shadow)">
      <rect x="620" y="72" width="530" height="486" rx="30" fill="#f7fbfc" stroke="#ffffff" stroke-opacity=".9"/>
    </g>

    <circle cx="654" cy="106" r="7" fill="#35e6a5"/>
    <text x="670" y="112" fill="#071826" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="800">Comparador Auto Pro</text>
    <text x="1080" y="112" fill="#61737f" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700">ANÁLISE</text>

    <rect x="646" y="138" width="478" height="58" rx="16" fill="#ffffff" stroke="#d8e5eb"/>
    <text x="666" y="174" fill="#7b8992" font-family="Arial,Helvetica,sans-serif" font-size="16">Cole o link, matrícula ou descrição…</text>
    <rect x="1016" y="148" width="96" height="38" rx="12" fill="#35e6a5"/>
    <text x="1033" y="173" fill="#063120" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="800">Analisar</text>

    <text x="646" y="232" fill="#6d7d87" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700">VIATURA ANALISADA</text>
    <text x="646" y="266" fill="#071826" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="800">Tesla Model Y</text>
    <text x="646" y="292" fill="#6d7d87" font-family="Arial,Helvetica,sans-serif" font-size="15">Long Range · 2023 · Automático</text>
    <rect x="1001" y="239" width="123" height="34" rx="17" fill="#e8fbf4"/>
    <text x="1017" y="261" fill="#167c5a" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="800">Confiança alta</text>

    <rect x="646" y="320" width="227" height="96" rx="18" fill="#0b2237" stroke="#17384f"/>
    <text x="666" y="347" fill="#b8c8d1" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700">COMPRA IDEAL</text>
    <text x="666" y="392" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="800">31.500 €</text>

    <rect x="885" y="320" width="239" height="96" rx="18" fill="#ffffff" stroke="#d8e5eb"/>
    <text x="905" y="347" fill="#6c7c87" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700">VENDA RÁPIDA</text>
    <text x="905" y="392" fill="#15966b" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="800">35.900 €</text>

    <rect x="646" y="432" width="478" height="98" rx="18" fill="#ffffff" stroke="#d8e5eb"/>
    <text x="666" y="461" fill="#071826" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700">Posição no mercado</text>
    <text x="1017" y="461" fill="#15966b" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="800">COMPETITIVO</text>
    <rect x="666" y="490" width="391" height="10" rx="5" fill="#e4eaee"/>
    <rect x="666" y="490" width="266" height="10" rx="5" fill="url(#bar)"/>
    <text x="1070" y="503" fill="#071826" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="800">68%</text>
  </svg>`;

  try {
    const png = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, no-transform');
    res.end(png);
  } catch (error) {
    console.error('[comparador-og-v5] failed', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('OG generation failed');
  }
};
