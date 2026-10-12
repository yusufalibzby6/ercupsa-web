import { $, api, onAdminEvent } from "./common.js";

let ready = false, active = false, loaded = false, dirty = false, loading = false, saving = false;
let revision = "", baseline = [], epoch = 0, requestVersion = 0, editVersion = 0;

function normalize(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Geçerli bir Instagram gönderi veya Reels bağlantısı girin."); }
  const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,100})\/?$/);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)
    || url.port || url.username || url.password || !match)
    throw new Error("Instagram gönderi (/p/) veya Reels (/reel/) bağlantısını kullanın.");
  return `https://www.instagram.com/${match[1]}/${match[2]}/`;
}
function inputs() { return [1, 2, 3, 4].map(number => $(`instagramPost${number}`)); }
function values() { return inputs().map(input => normalize(input.value)); }
function message(value, error = false) {
  $("instagramMessage").textContent = value;
  $("instagramMessage").dataset.error = String(error);
}
function controls() {
  for (const input of inputs()) input.disabled = !ready || !loaded || saving;
  $("instagramSave").disabled = !ready || !loaded || loading || saving || !dirty;
  $("instagramPreview").disabled = !ready || !loaded || saving;
  $("instagramReload").disabled = !ready || loading || saving;
}
function preview(posts) {
  const cards = posts.map((url, index) => {
    const card = document.createElement("article"); card.className = "instagram-admin-preview";
    const number = document.createElement("span"); number.className = "instagram-slot-number"; number.textContent = `${index + 1}. alan`;
    const icon = document.createElement("div"); icon.className = "instagram-preview-icon"; icon.textContent = "◎"; icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("strong"); title.textContent = new URL(url).pathname.startsWith("/reel/") ? "Instagram Reels" : "Instagram gönderisi";
    const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Instagram’da önizle ↗";
    card.append(number, icon, title, link); return card;
  });
  $("instagramPreviewCards").replaceChildren(...cards);
}
function content(data) {
  const value = data?.instagram;
  if (!value || !Array.isArray(value.posts) || value.posts.length !== 4 || typeof value.revision !== "string")
    throw new Error("Kaydedilmiş paylaşımlar doğrulanamadı. Yeniden yükleyin.");
  return { posts: value.posts.map(normalize), revision: value.revision };
}
async function load() {
  if (!ready || !active || loading || saving) return;
  const version = ++requestVersion, auth = epoch, edit = editVersion;
  loading = true; controls(); message("Kaydedilmiş paylaşımlar yükleniyor…");
  try {
    const result = content(await api("/api/site-content"));
    if (version !== requestVersion || epoch !== auth || edit !== editVersion || !ready || !active) return;
    baseline = result.posts; revision = result.revision; loaded = true; dirty = false;
    inputs().forEach((input, index) => { input.value = baseline[index]; });
    preview(baseline); message("Soldan sağa 4 paylaşım. Değişiklikler kaydedildiğinde ana sayfaya yansır.");
  } catch (error) {
    if (version === requestVersion && epoch === auth && ready && active) message(error.message, true);
  } finally {
    if (version === requestVersion && epoch === auth) { loading = false; controls(); }
  }
}
const fragment = document.createDocumentFragment();
for (let number = 1; number <= 4; number++) {
  const label = document.createElement("label"); label.className = "instagram-admin-input";
  const heading = document.createElement("span"); heading.textContent = `${number}. paylaşım`;
  const input = document.createElement("input"); input.id = `instagramPost${number}`; input.name = input.id;
  input.type = "url"; input.required = true; input.maxLength = 2048; input.inputMode = "url";
  input.placeholder = "https://www.instagram.com/p/…/"; input.autocomplete = "off"; input.spellcheck = false;
  input.addEventListener("input", () => {
    editVersion++;
    dirty = inputs().some((field, index) => field.value.trim() !== baseline[index]);
    message("Kaydedilmemiş değişiklikler var. Önizleyip 4 paylaşımı birlikte kaydedebilirsiniz."); controls();
  });
  label.append(heading, input); fragment.append(label);
}
$("instagramInputs").append(fragment);
$("instagramReload").addEventListener("click", () => {
  if (dirty && !confirm("Kaydedilmemiş Instagram bağlantıları kaldırılsın ve sunucudaki paylaşımlar yüklensin mi?")) return;
  load();
});
$("instagramPreview").addEventListener("click", () => {
  try { preview(values()); message(dirty ? "Önizleme güncellendi. Ana sayfaya yansıtmak için kaydedin." : "Kaydedilmiş 4 paylaşım gösteriliyor."); }
  catch (error) { message(error.message, true); }
});
$("instagramForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!ready || !loaded || loading || saving || !dirty) return;
  let posts;
  try { posts = values(); } catch (error) { message(error.message, true); return; }
  const auth = epoch, edit = editVersion;
  saving = true; controls(); message("4 paylaşım kaydediliyor…");
  try {
    const result = content(await api("/api/site-content", { method: "POST", body: JSON.stringify({ posts, revision }) }));
    if (auth !== epoch || !ready || edit !== editVersion) return;
    baseline = result.posts; revision = result.revision; dirty = false;
    inputs().forEach((input, index) => { input.value = baseline[index]; });
    preview(baseline); message("4 paylaşım kaydedildi. Ana sayfada yeni bağlantılar gösteriliyor.");
  } catch (error) {
    if (auth === epoch && ready) message(`${error.message} Girdiğiniz bağlantılar korundu.`, true);
  } finally { if (auth === epoch) { saving = false; controls(); } }
});
onAdminEvent("admin-ready", () => { ready = true; controls(); if (active && !loaded) load(); });
document.addEventListener("admin-tab", event => {
  active = event.detail === "instagram";
  if (active && ready && !loaded) load();
  else if (!active) { requestVersion++; loading = false; controls(); }
});
document.addEventListener("admin-logout", () => {
  ready = false; active = false; loaded = false; dirty = false; loading = false; saving = false;
  epoch++; requestVersion++; editVersion++; revision = ""; baseline = [];
  inputs().forEach(input => { input.value = ""; });
  $("instagramPreviewCards").replaceChildren(); message(""); controls();
});
window.addEventListener("beforeunload", event => { if (ready && dirty) { event.preventDefault(); event.returnValue = ""; } });
controls();
