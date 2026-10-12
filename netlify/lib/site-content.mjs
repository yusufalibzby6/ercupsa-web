import { fail, text } from "./security.mjs";

export const DEFAULT_INSTAGRAM_POSTS = Object.freeze([
  "https://www.instagram.com/p/DYNe6W6Cmk4/",
  "https://www.instagram.com/p/DYU7z9ECgxc/",
  "https://www.instagram.com/p/DRkMhWUiLtv/",
  "https://www.instagram.com/p/DP_JtyLCBAy/",
]);

export function instagramPostUrl(value) {
  const source = text(value, 2048, true);
  let url;
  try { url = new URL(source); } catch { fail(400, "Geçerli bir Instagram gönderi veya Reels bağlantısı girin."); }
  const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,100})\/?$/);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)
    || url.port || url.username || url.password || !match)
    fail(400, "Yalnızca Instagram gönderi (/p/) veya Reels (/reel/) bağlantıları kullanılabilir.");
  return `https://www.instagram.com/${match[1]}/${match[2]}/`;
}

export function instagramPosts(value) {
  if (!Array.isArray(value) || value.length !== 4)
    fail(400, "Ana sayfa için tam 4 Instagram bağlantısı girin.");
  return value.map(instagramPostUrl);
}

export function readInstagramContent(value) {
  if (value == null) return { posts: [...DEFAULT_INSTAGRAM_POSTS], revision: "", updatedAt: null };
  try {
    if (!value || typeof value !== "object" || typeof value.revision !== "string"
      || (value.revision === "" ? value.updatedAt !== null
        : !/^[A-Za-z0-9_-]{1,100}$/.test(value.revision)
          || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)))) throw Error();
    return { posts: instagramPosts(value.posts), revision: value.revision, updatedAt: value.updatedAt };
  } catch { fail(503, "Instagram paylaşımları doğrulanamadı. Lütfen tekrar deneyin."); }
}
