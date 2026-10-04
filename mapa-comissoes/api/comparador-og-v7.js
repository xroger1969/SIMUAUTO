const sharp = require('sharp');

module.exports = async function handler(req, res) {
  try {
    const heroUrl = 'https://mapa-comercial-sand.vercel.app/comparador-auto-pro/assets/car-sunset.webp';
    const heroResp = await fetch(heroUrl, { headers: { 'User-Agent': 'Comparador-Auto-Pro-OG/1.0' } });
    if (!heroResp.ok) throw new Error('hero fetch failed: ' + heroResp.status);
    const hero = Buffer.from(await heroResp.arrayBuffer());

    const overlay = Buffer.from(`
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#06131f" stop-opacity=".94"/>
            <stop offset="48%" stop-color="#082039" stop-opacity=".72"/>
            <stop offset="100%" stop-color="#06223a" stop-opacity=".14"/>
          </linearGradient>
          <linearGradient id="green" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#36e6a6"/>
            <stop offset="100%" stop-color="#15c982"/>
          </linearGradient>
          <filter id="shadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#00101c" flood-opacity=".42"/>
          </filter>
        </defs>
        <rect width="1200" height="630" fill="url(#shade)"/>

        <g transform="translate(58 55)">
          <circle cx="48" cy="48" r="42" fill="none" stroke="#f7fbfc" stroke-width="10"/>
          <line x1="49" y1="50" x2="79" y2="25" stroke="#35e6a5" stroke-width="11" stroke-linecap="round"/>
          <circle cx="49" cy="50" r="8" fill="#35e6a5"/>
          <text x="112" y="45" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="800" letter-spacing="-2">Comparador</text>
          <text x="112" y="105" fill="#35e6a5" font-family="Arial,Helvetica,sans-serif" font-size="62" font-weight="800" letter-spacing="-2">Auto Pro</text>
        </g>

        <text x="64" y="246" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700">Avalie viaturas com rapidez</text>
        <text x="64" y="288" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700">e inteligência.</text>
        <text x="64" y="335" fill="#c5d7e1" font-family="Arial,Helvetica,sans-serif" font-size="20">Compra ideal · Mercado profissional · Venda rápida</text>

        <g transform="translate(64 390)" font-family="Arial,Helvetica,sans-serif">
          <rect x="0" y="0" width="136" height="66" rx="18" fill="#081d30" fill-opacity=".78" stroke="#4d7288" stroke-opacity=".45"/>
          <circle cx="32" cy="29" r="12" fill="none" stroke="#35e6a5" stroke-width="4"/>
          <line x1="41" y1="38" x2="50" y2="47" stroke="#35e6a5" stroke-width="4" stroke-linecap="round"/>
          <text x="20" y="88" fill="#ffffff" font-size="17" font-weight="700">Análise IA</text>
          <rect x="166" y="0" width="136" height="66" rx="18" fill="#081d30" fill-opacity=".78" stroke="#4d7288" stroke-opacity=".45"/>
          <rect x="193" y="32" width="8" height="18" rx="2" fill="#35e6a5"/>
          <rect x="207" y="21" width="8" height="29" rx="2" fill="#35e6a5"/>
          <rect x="221" y="10" width="8" height="40" rx="2" fill="#35e6a5"/>
          <text x="176" y="88" fill="#ffffff" font-size="17" font-weight="700">Preços reais</text>
          <rect x="332" y="0" width="136" height="66" rx="18" fill="#081d30" fill-opacity=".78" stroke="#4d7288" stroke-opacity=".45"/>
          <path d="M365 14h31v38h-31z M372 24h17 M372 32h17 M372 40h12" fill="none" stroke="#35e6a5" stroke-width="3" stroke-linejoin="round"/>
          <text x="337" y="88" fill="#ffffff" font-size="17" font-weight="700">Decisão rápida</text>
        </g>

        <g transform="translate(590 95) rotate(-2 280 220)" filter="url(#shadow)" font-family="Arial,Helvetica,sans-serif">
          <rect x="0" y="0" width="565" height="455" rx="28" fill="#f6fafc" stroke="#d7e3e9" stroke-width="2"/>
          <circle cx="32" cy="33" r="13" fill="none" stroke="#0b2237" stroke-width="4"/>
          <line x1="32" y1="33" x2="42" y2="24" stroke="#35e6a5" stroke-width="4" stroke-linecap="round"/>
          <text x="55" y="40" fill="#0b2237" font-size="21" font-weight="800">Comparador <tspan fill="#12bd79">Auto Pro</tspan></text>
          <text x="423" y="38" fill="#0b2237" font-size="14" font-weight="700">Analisar</text>
          <rect x="421" y="47" width="55" height="3" rx="2" fill="#35e6a5"/>
          <rect x="24" y="72" width="517" height="62" rx="16" fill="#ffffff" stroke="#d7e3e9"/>
          <text x="48" y="111" fill="#82919a" font-size="17">Cole o link, matrícula ou descrição da viatura...</text>
          <rect x="430" y="83" width="95" height="40" rx="12" fill="url(#green)"/>
          <text x="451" y="109" fill="#053821" font-size="16" font-weight="800">Analisar</text>

          <rect x="24" y="153" width="517" height="114" rx="18" fill="#ffffff" stroke="#d7e3e9"/>
          <rect x="40" y="171" width="114" height="78" rx="12" fill="#dfe8ed"/>
          <path d="M52 229c12-24 28-37 48-39 22-2 39 8 48 30l-9 6H61z" fill="#2b3b47"/>
          <circle cx="76" cy="227" r="9" fill="#0c1820"/>
          <circle cx="130" cy="227" r="9" fill="#0c1820"/>
          <text x="172" y="190" fill="#0b2237" font-size="22" font-weight="800">BMW Série 3</text>
          <text x="172" y="214" fill="#657780" font-size="15">320d Touring · 2021</text>
          <text x="172" y="241" fill="#657780" font-size="14">Diesel · 190 cv · Automático</text>
          <line x1="350" y1="169" x2="350" y2="249" stroke="#e0e7eb"/>
          <text x="370" y="188" fill="#657780" font-size="13">PREÇO DE MERCADO</text>
          <text x="370" y="220" fill="#0b2237" font-size="27" font-weight="800">28.500 € – 32.900 €</text>
          <rect x="370" y="235" width="142" height="8" rx="4" fill="#dce6eb"/>
          <rect x="370" y="235" width="91" height="8" rx="4" fill="#35e6a5"/>
          <circle cx="461" cy="239" r="7" fill="#0b2237"/>

          <rect x="24" y="285" width="158" height="132" rx="18" fill="#ffffff" stroke="#d7e3e9"/>
          <text x="42" y="312" fill="#0b2237" font-size="15" font-weight="800">Evolução de preços</text>
          <polyline points="43,381 64,365 87,368 108,348 130,358 153,343" fill="none" stroke="#20c889" stroke-width="4"/>
          <rect x="195" y="285" width="158" height="132" rx="18" fill="#ffffff" stroke="#d7e3e9"/>
          <text x="214" y="312" fill="#0b2237" font-size="15" font-weight="800">Confiabilidade</text>
          <circle cx="246" cy="355" r="28" fill="none" stroke="#dbe5ea" stroke-width="8"/>
          <path d="M225 372 A28 28 0 1 1 269 369" fill="none" stroke="#20c889" stroke-width="8" stroke-linecap="round"/>
          <text x="232" y="361" fill="#0b2237" font-size="20" font-weight="800">8.5</text>
          <text x="287" y="346" fill="#58707c" font-size="12">Histórico positivo</text>
          <text x="287" y="367" fill="#58707c" font-size="12">Boa reputação</text>
          <text x="287" y="388" fill="#58707c" font-size="12">Custos controlados</text>
          <rect x="366" y="285" width="175" height="132" rx="18" fill="#ffffff" stroke="#d7e3e9"/>
          <text x="386" y="312" fill="#0b2237" font-size="15" font-weight="800">Resumo da análise</text>
          <text x="386" y="343" fill="#20a875" font-size="14">✓ Preço de mercado</text>
          <text x="386" y="368" fill="#20a875" font-size="14">✓ Pontos fortes</text>
          <text x="386" y="393" fill="#20a875" font-size="14">✓ Custos estimados</text>
        </g>
      </svg>
    `);

    const out = await sharp(hero)
      .resize(1200, 630, { fit: 'cover', position: 'centre' })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(out.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, no-transform');
    res.end(out);
  } catch (error) {
    console.error('[comparador-og-v7] failed', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('OG generation failed');
  }
};
