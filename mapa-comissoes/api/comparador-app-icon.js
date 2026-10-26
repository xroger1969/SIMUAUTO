const sharp = require("sharp");

module.exports = async function handler(req, res) {
  try {
    const imageUrl = "https://mapa-comercial-sand.vercel.app/comparador-auto-pro/assets/cockpit-car.webp";
    const response = await fetch(imageUrl, { headers: { "User-Agent": "Avaliador-Auto-Pro-Icon/2.0" } });
    if (!response.ok) throw new Error("car image fetch failed: " + response.status);
    const car = Buffer.from(await response.arrayBuffer());
    const size = 1024;
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08090d" stop-opacity=".92"/><stop offset=".55" stop-color="#08090d" stop-opacity=".13"/><stop offset="1" stop-color="#08090d" stop-opacity=".40"/></linearGradient>
        <linearGradient id="orange" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffad5b"/><stop offset=".48" stop-color="#ff6a2b"/><stop offset="1" stop-color="#d83808"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="11"/></filter>
      </defs>
      <rect width="1024" height="1024" fill="url(#shade)"/>
      <rect x="12" y="12" width="1000" height="1000" rx="190" fill="none" stroke="#ff6a2b" stroke-width="15"/>
      <g transform="translate(45 360)">
        <circle cx="280" cy="210" r="194" fill="#090b10" fill-opacity=".82" stroke="#ff6a2b" stroke-width="31"/>
        <path d="M414 355 L545 486" stroke="#ff6a2b" stroke-width="66" stroke-linecap="round"/>
        <path d="M151 228 L172 172 Q188 139 231 139 H331 Q374 139 390 172 L412 228 L412 282 Q412 301 393 301 H169 Q150 301 150 282 Z" fill="#f7f7f8"/>
        <path d="M208 204 L229 166 H334 L355 204 Z" fill="#15171c"/>
        <path d="M183 254 H223 M339 254 H379" stroke="#ff6a2b" stroke-width="16" stroke-linecap="round"/>
      </g>
      <g fill="url(#orange)">
        <rect x="520" y="888" width="54" height="85" rx="12"/><rect x="593" y="845" width="54" height="128" rx="12"/>
        <rect x="666" y="803" width="54" height="170" rx="12"/><rect x="739" y="750" width="54" height="223" rx="12"/>
        <path d="M514 871 Q668 845 821 709" fill="none" stroke="#ff6a2b" stroke-width="12" stroke-linecap="round"/>
        <path d="M804 709 L842 684 L835 730 Z"/>
      </g>
    </svg>`);
    const png = await sharp(car)
      .resize(size, size, { fit: "cover", position: "right" })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .flatten({ background: "#08090d" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(png);
  } catch (error) {
    res.status(500).json({ error: "icon_render_failed" });
  }
};
