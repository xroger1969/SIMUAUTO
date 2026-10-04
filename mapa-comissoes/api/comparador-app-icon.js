const sharp = require("sharp");

module.exports = async function handler(req, res) {
  try {
    const heroUrl = "https://mapa-comercial-sand.vercel.app/comparador-auto-pro/assets/car-sunset.webp";
    const heroResp = await fetch(heroUrl, {
      headers: { "User-Agent": "Comparador-Auto-Pro-App-Icon/1.0" }
    });
    if (!heroResp.ok) throw new Error("hero fetch failed: " + heroResp.status);

    const hero = Buffer.from(await heroResp.arrayBuffer());

    const overlay = Buffer.from(`
      <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#061426" stop-opacity=".34"/>
            <stop offset="52%" stop-color="#061426" stop-opacity=".06"/>
            <stop offset="100%" stop-color="#020811" stop-opacity=".52"/>
          </linearGradient>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="48%" stop-color="#dff6ff"/>
            <stop offset="100%" stop-color="#35b9ff"/>
          </linearGradient>
          <linearGradient id="arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#18d8ff"/>
            <stop offset="100%" stop-color="#2f6bff"/>
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        <rect width="512" height="512" fill="url(#shade)"/>

        <g transform="translate(42 46)" filter="url(#glow)">
          <circle cx="150" cy="150" r="104" fill="rgba(7,28,55,.38)" stroke="url(#ring)" stroke-width="14"/>
          <path d="M74 228 L27 276" stroke="url(#ring)" stroke-width="19" stroke-linecap="round"/>

          <path d="M116 143
                   C119 126 130 112 147 108
                   L182 108
                   C199 112 210 126 213 143
                   L219 164
                   C220 172 214 179 206 179
                   L112 179
                   C104 179 98 172 99 164
                   Z"
                fill="#f7fbff"/>
          <rect x="112" y="153" width="94" height="20" rx="10" fill="#0c2440"/>
          <path d="M127 143 L139 124 H185 L197 143 Z" fill="#0c2440"/>
          <circle cx="123" cy="166" r="7" fill="#f7fbff"/>
          <circle cx="194" cy="166" r="7" fill="#f7fbff"/>

          <path d="M258 65 A168 168 0 0 1 327 145" fill="none" stroke="url(#arc)" stroke-width="17" stroke-linecap="butt"/>
          <path d="M243 90 A136 136 0 0 1 293 151" fill="none" stroke="#1fd5ff" stroke-width="10" stroke-linecap="butt" opacity=".92"/>
        </g>

        <path d="M42 394 C145 339 242 336 352 359" fill="none" stroke="#5bdcff" stroke-width="9" stroke-linecap="round" opacity=".9" filter="url(#glow)"/>
      </svg>
    `);

    const png = await sharp(hero)
      .resize(512, 512, { fit: "cover", position: "right" })
      .modulate({ saturation: 1.12, brightness: 0.97 })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(png);
  } catch (error) {
    res.status(500).json({ error: "icon_render_failed" });
  }
};
