import { instagramAllowed, mountPrivacyPreferences } from './privacy-preferences.js';
const grid = document.getElementById('homeInstagramCards');
if (grid) {
  const defaults = [...grid.querySelectorAll('[data-instgrm-permalink]')].map(card => card.dataset.instgrmPermalink);
  let posts = [...defaults], requested = false, script;
  function normalize(value) {
    if (typeof value !== 'string' || value.length > 2048) throw Error();
    const url = new URL(value), match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,100})\/?$/);
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password || !match) throw Error();
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  }
  function processEmbeds() {
    if (!instagramAllowed()) return;
    try { window.instgrm?.Embeds?.process(); } catch { /* Direct links remain available. */ }
  }
  function render() {
    grid.replaceChildren(...posts.map((url, index) => {
      const card = document.createElement('article'); card.className = 'home-instagram-card';
      const heading = document.createElement('div'); heading.className = 'home-instagram-card-heading';
      const icon = document.createElement('i'); icon.className = 'fa-brands fa-instagram'; icon.setAttribute('aria-hidden', 'true');
      const brand = document.createElement('strong'); brand.textContent = '@ercupsa';
      const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
      heading.append(icon, brand, number);
      const embed = document.createElement('div'); embed.className = 'home-instagram-embed';
      const quote = document.createElement('blockquote'); quote.className = 'instagram-media'; quote.dataset.instgrmPermalink = url; quote.dataset.instgrmVersion = '14';
      const fallback = document.createElement('a'); fallback.href = url; fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
      const symbol = document.createElement('i'); symbol.className = 'fa-brands fa-instagram'; symbol.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = 'Bu paylaşımı Instagram’da keşfet';
      fallback.append(symbol, label); quote.append(fallback); embed.append(quote);
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'home-instagram-open'; link.textContent = 'Instagram’da aç ↗';
      card.append(heading, embed, link); return card;
    }));
    processEmbeds();
  }
  function loadEmbeds() {
    if (!instagramAllowed() || requested) return;
    requested = true;
    script = document.createElement('script'); script.src = 'https://www.instagram.com/embed.js'; script.async = true; script.dataset.ercupsaInstagram = 'true';
    script.addEventListener('load', processEmbeds);
    document.head.append(script);
  }
  mountPrivacyPreferences(document.getElementById('instagramPrivacy'));
  window.addEventListener('ercupsa-privacy-change', () => {
    if (instagramAllowed()) loadEmbeds();
    else {
      grid.querySelectorAll('iframe').forEach(frame => frame.remove());
      script?.remove();
      render();
      // Removing a script element cannot stop code already run by a third party.
      // A clean navigation starts without loading that SDK under the saved choice.
      if (requested) location.reload();
    }
  });
  loadEmbeds();
  try {
    const response = await fetch('/api/site-content', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const data = await response.json(), saved = data.instagram?.posts;
      if (Array.isArray(saved) && saved.length === 4) {
        const valid = saved.map(normalize);
        if (valid.some((url, index) => url !== defaults[index])) { posts = valid; render(); }
      }
    }
  } catch { /* Static fallback links remain usable without an embed or content service. */ }
}
