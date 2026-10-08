import { $, escape, safeImage, status, announceAdminEvents, announceAdminReady } from "./common.js?v=raffle-2";
let events = [],
  photos = [],
  poster = "",
  selectedId = "";
let authenticated = false, editorOpen = false, saving = false, restored = false, loggingIn = false, authGeneration = 0, loadVersion = 0;
let savedValue = null;
const drafts = new Map(), revisions = new Map(), uploads = new Set();
const DRAFT_KEY = "ercupsa_event_drafts_v1";
const fields = [
  "title",
  "category",
  "date",
  "time",
  "location",
  "registrationUrl",
  "description",
];
const keyFor = (id) => id ? `event:${id}` : "new";
const editorKey = () => keyFor(selectedId);
function eventValue(event = {}, id = "") {
  return {
    ...Object.fromEntries(fields.map((field) => [field, typeof event[field] === "string" ? event[field] : ""])),
    id, published: event.published === true,
    poster: event.poster || "", images: structuredClone(event.images || []),
  };
}
function emptyValue() { return eventValue({ category: "Etkinlik" }); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function validValue(value, id) {
  if (!value || typeof value !== "object" || value.id !== id || typeof value.published !== "boolean") return false;
  if (fields.some(field => typeof value[field] !== "string" || value[field].length > 50000)) return false;
  if (typeof value.poster !== "string" || value.poster.length > 2048 || (value.poster && !safeImage(value.poster))) return false;
  if (!Array.isArray(value.images) || value.images.length > 100) return false;
  return value.images.every(photo => photo && typeof photo.url === "string" && photo.url.length <= 2048 && safeImage(photo.url) &&
    typeof photo.publicId === "string" && photo.publicId.length <= 250 && Number.isInteger(photo.width) && Number.isInteger(photo.height));
}
function readDrafts() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw || raw.length > 2000000) return null;
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.drafts) || stored.drafts.length > 50) throw new Error("Invalid drafts");
    for (const draft of stored.drafts) {
      const id = draft?.key === "new" ? "" : draft?.key?.startsWith("event:") ? draft.key.slice(6) : null;
      if (id === null || (id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || !validValue(draft.value, id) || !validValue(draft.base, id)) continue;
      if (id && !events.some(event => event.id === id)) continue;
      if (!same(draft.value, draft.base)) drafts.set(draft.key, { value: eventValue(draft.value, id), base: eventValue(draft.base, id) });
    }
    return typeof stored.active === "string" && (stored.active === "new" || events.some(event => keyFor(event.id) === stored.active)) ? stored : null;
  } catch {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
    return null;
  }
}
function persistDrafts() {
  if (!authenticated) return;
  try {
    if (!drafts.size && !editorOpen) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, drafts: [...drafts].map(([key, draft]) => ({ key, ...draft })), active: editorOpen ? editorKey() : null }));
  } catch {
    if (drafts.size) notify("Taslak bu sekmede korunuyor; sayfayı yenilemeden önce kaydedin. Tarayıcı taslak saklamaya izin vermedi.");
  }
}
function remember() {
  if (!authenticated || !editorOpen || !savedValue) return;
  const value = eventValue(current(), selectedId), key = editorKey();
  if (same(value, savedValue)) drafts.delete(key);
  else drafts.set(key, { value, base: structuredClone(savedValue) });
  persistDrafts();
  draftNotice();
}
function draftNotice() {
  const dirty = editorOpen && drafts.has(editorKey());
  const pending = editorOpen && [...uploads].some(upload => upload.key === editorKey());
  const latest = selectedId && events.find(event => event.id === selectedId);
  const remoteChanged = dirty && latest && !same(savedValue, eventValue(latest, selectedId));
  $("eventDraftNotice").hidden = !dirty && !pending;
  $("eventDraftNotice").textContent = pending ? "Görsel yükleme sürüyor. Yükleme tamamlandığında etkinliği kaydedebilirsiniz." :
    `${restored ? "Kaydedilmemiş taslağınız geri yüklendi. " : "Kaydedilmemiş değişiklikleriniz var. "}Etkinlik değiştirirken, kapatırken ve bu sekmeyi yenilerken korunur.${remoteChanged ? " Sunucudaki etkinlik bu sırada değişmiş; kaydetmeden önce güncel etkinliği kontrol edin." : ""}`;
  $("eventDiscard").hidden = !dirty;
  $("eventDiscard").textContent = selectedId ? "Kaydedilmiş etkinliğe dön" : "Yeni taslağı sil";
  $("eventDiscard").disabled = saving;
  $("saveBtn").disabled = saving || pending;
  [...fields, "published", "posterBtn", "photosBtn", "newBtn", "cancelBtn"].forEach(id => { $(id).disabled = saving; });
  $("photoThumbs").querySelectorAll("button").forEach(button => { button.disabled = saving; });
}
function forget(key) {
  drafts.delete(key);
  revisions.set(key, (revisions.get(key) || 0) + 1);
  for (const upload of uploads) if (upload.key === key) uploads.delete(upload);
}
function clearPrivateDrafts(event) {
  authenticated = false;
  authGeneration++;
  loadVersion++;
  drafts.clear(); revisions.clear(); uploads.clear();
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
  reset();
  $("formWrap").classList.add("hidden");
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  // An initial cookie probe may finish while someone is already typing into the login form.
  if (event?.detail?.reason !== "initial-session-probe") $("password").value = "";
}
async function api(path, opts = {}) {
  const generation = authGeneration;
  const response = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...opts.headers }, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if ([401, 403].includes(response.status) && generation === authGeneration) {
      document.dispatchEvent(new CustomEvent("admin-logout", { detail: { reason: !authenticated && !loggingIn ? "initial-session-probe" : "session-expired" } }));
      $("loginError").textContent = data.error || "Yönetici oturumunuz sona erdi. Tekrar giriş yapın.";
    }
    throw new Error(data.error || "İşlem tamamlanamadı.");
  }
  return data;
}
function notify(s) {
  $("saveStatus").textContent = s;
}
function image(url, cls = "w-24 h-24 object-cover rounded-xl") {
  const src = safeImage(url);
  return src ? `<img src="${src}" alt="Etkinlik görseli" class="${cls}">` : "";
}
async function load() {
  remember();
  const version = ++loadVersion;
  const d = await api("/api/events?admin=true");
  if (version !== loadVersion) return false;
  events = d.events;
  for (const key of drafts.keys()) if (key !== "new" && !events.some(event => keyFor(event.id) === key)) forget(key);
  if (editorOpen && selectedId && !events.some(event => event.id === selectedId)) {
    reset(); $("formWrap").classList.add("hidden");
    notify("Bu etkinlik artık listede bulunmuyor. Düzenleme kapatıldı.");
  } else if (editorOpen && selectedId && !drafts.has(editorKey())) {
    // A clean editor follows refreshed saved data; an unsaved draft is never overwritten.
    savedValue = eventValue(events.find(event => event.id === selectedId), selectedId);
    fillEditor(savedValue);
    restored = false;
  }
  persistDrafts();
  render();
  announceAdminEvents(events);
  draftNotice();
  return true;
}
function hasRegistrationLink(event) {
  if (!event.published) return false;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
  if (event.date < today) return false;
  if (event.registrationMode === "native") return event.registrationEnabled === true;
  try {
    return ["https:", "http:"].includes(new URL(event.registrationUrl).protocol);
  } catch {
    return false;
  }
}
function render() {
  const q = $("eventSearch").value.toLocaleLowerCase("tr");
  $("eventsList").innerHTML =
    events
      .filter((e) => e.title.toLocaleLowerCase("tr").includes(q))
      .map(
        (e) =>
          `<article class="card p-5 rounded-3xl flex flex-wrap justify-between gap-4"><div class="flex gap-4">${image(e.poster)}<div><p class="text-sm">${escape(e.category)} · ${escape(e.date)} · ${e.published ? "Yayında" : "Taslak"}</p><h3 class="font-bold text-xl">${escape(e.title)}</h3><p>${escape(e.location)} ${escape(e.time)}</p><p>${e.images.length} fotoğraf</p></div></div><div class="flex flex-wrap gap-2 items-center"><button data-action="publish" data-id="${escape(e.id)}" class="border rounded-xl p-2">${e.published ? "Yayından kaldır" : "Yayınla"}</button><button data-action="edit" data-id="${escape(e.id)}" class="border rounded-xl p-2">Düzenle</button><button data-action="registration" data-id="${escape(e.id)}" class="border rounded-xl p-2">Kayıt formu</button>${hasRegistrationLink(e) ? `<button data-action="copy-registration" data-id="${escape(e.id)}" class="border rounded-xl p-2">Kayıt linkini kopyala</button>` : ""}${e.published ? `<button data-action="share" data-id="${escape(e.id)}" class="border rounded-xl p-2">Etkinliği paylaş</button>` : ""}<button data-action="ticket" data-id="${escape(e.id)}" class="border rounded-xl p-2">Bilet oluştur</button><button data-action="delete" data-id="${escape(e.id)}" class="text-red-700 p-2">Sil</button></div></article>`,
      )
      .join("") || "<p>Etkinlik bulunamadı.</p>";
}
function reset() {
  selectedId = "";
  fields.forEach((f) => ($(f).value = f === "category" ? "Etkinlik" : ""));
  $("published").checked = false;
  poster = "";
  photos = [];
  savedValue = null;
  editorOpen = false;
  restored = false;
  $("eventId").value = "";
  thumbs();
  $("preview").hidden = true;
  draftNotice();
}
function fillEditor(value) {
  selectedId = value.id;
  fields.forEach((f) => ($(f).value = value[f]));
  $("published").checked = value.published;
  poster = value.poster;
  photos = structuredClone(value.images);
  $("eventId").value = value.id;
  thumbs();
  $("preview").hidden = true;
}
function edit(e) {
  if (saving || !authenticated) return;
  remember();
  const id = e?.id || "", draft = drafts.get(keyFor(id));
  savedValue = draft ? structuredClone(draft.base) : id ? eventValue(e, id) : emptyValue();
  fillEditor(draft ? draft.value : savedValue);
  editorOpen = true;
  restored = !!draft;
  $("formWrap").classList.remove("hidden");
  $("formTitle").textContent = id ? "Etkinliği düzenle" : "Yeni etkinlik";
  notify(draft ? "Kaydedilmemiş taslağınız geri yüklendi." : "");
  draftNotice();
  persistDrafts();
  window.scrollTo({ top: 0 });
}
function thumbs() {
  $("posterPreview").innerHTML = image(poster);
  $("photoCount").textContent = `${photos.length} fotoğraf`;
  $("photoThumbs").innerHTML = photos
    .map(
      (p, i) =>
        `<div>${image(p.url, "w-full aspect-square object-cover rounded-lg")}<div class="flex gap-2"><button data-photo="${i}" data-move="-1" aria-label="Fotoğrafı öne taşı">←</button><button data-photo="${i}" data-move="1" aria-label="Fotoğrafı sona taşı">→</button><button data-photo="${i}" data-move="0" aria-label="Fotoğrafı kaldır">×</button></div></div>`,
    )
    .join("");
}
function current() {
  const e = Object.fromEntries(fields.map((f) => [f, $(f).value]));
  return {
    ...e,
    id: selectedId || undefined,
    published: $("published").checked,
    poster,
    images: photos,
  };
}
$("eventsList").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-action]");
  if (!b) return;
  const e = events.find((e) => e.id === b.dataset.id);
  if (!e) return;
  if (saving && ["edit", "publish", "delete"].includes(b.dataset.action)) {
    notify("Etkinlik kaydediliyor. İşlem tamamlanınca devam edebilirsiniz.");
    return;
  }
  b.disabled = true;
  try {
    if (b.dataset.action === "share") {
      const url = `https://ercupsa.com.tr/etkinlik/${encodeURIComponent(e.id)}`;
      try {
        await navigator.clipboard.writeText(url);
        status("Etkinlik paylaşım bağlantısı kopyalandı.");
      } catch {
        status(`Etkinlik paylaşım bağlantısı: ${url}`);
      }
    }
    if (b.dataset.action === "copy-registration") {
      const url = new URL(`form.html?event=${encodeURIComponent(e.id)}#registrationSection`, location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        status("Kayıt bağlantısı kopyalandı.");
      } catch {
        status(`Kayıt bağlantısı: ${url}`);
      }
    }
    if (b.dataset.action === "edit") edit(e);
    if (b.dataset.action === "registration")
      document.dispatchEvent(new CustomEvent("registration-event", { detail: e }));
    if (b.dataset.action === "ticket")
      document.dispatchEvent(new CustomEvent("ticket-event", { detail: e }));
    if (b.dataset.action === "publish") {
      await api("/api/events", {
        method: "POST",
        body: JSON.stringify({ event: { ...e, published: !e.published } }),
      });
      await load();
    }
    if (
      b.dataset.action === "delete" &&
      confirm(
        "Etkinlik silinecek. Bu işlem geri alınamaz. Bilet geçmişi korunur. Devam edilsin mi?",
      )
    ) {
      await api("/api/events?id=" + encodeURIComponent(e.id), {
        method: "DELETE",
      });
      await load();
    }
  } catch (e) {
    notify(e.message);
  } finally {
    b.disabled = false;
  }
});
$("photoThumbs").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-photo]");
  if (!b) return;
  const i = Number(b.dataset.photo),
    move = Number(b.dataset.move);
  if (!move) photos.splice(i, 1);
  else if (photos[i + move])
    [photos[i], photos[i + move]] = [photos[i + move], photos[i]];
  thumbs();
  remember();
});
$("eventSearch").addEventListener("input", render);
$("newBtn").onclick = () => edit(null);
$("cancelBtn").onclick = () => {
  if (saving) return;
  remember();
  editorOpen = false;
  $("formWrap").classList.add("hidden");
  persistDrafts();
  if (drafts.size) status("Kaydedilmemiş etkinlik taslakları bu sekmede korunuyor. Düzenle veya Yeni etkinlik ile devam edebilirsiniz.");
};
if (!$("eventDraftNotice")) {
  const notice = document.createElement("p");
  notice.id = "eventDraftNotice";
  notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
  notice.className = "text-sm text-gray-600 mb-4"; notice.hidden = true;
  $("formWrap").firstElementChild.after(notice);
}
if (!$("eventDiscard")) {
  const discard = document.createElement("button");
  discard.id = "eventDiscard"; discard.type = "button";
  discard.className = "border rounded-xl p-3 mt-5"; discard.hidden = true;
  $("previewBtn").after(discard);
}
$("eventDiscard").onclick = () => {
  if (saving || !confirm("Bu etkinliğin kaydedilmemiş değişiklikleri silinsin mi?")) return;
  const id = selectedId;
  forget(editorKey());
  const event = events.find(event => event.id === id);
  savedValue = id && event ? eventValue(event, id) : emptyValue();
  fillEditor(savedValue);
  restored = false;
  persistDrafts(); draftNotice();
  notify(id ? "Kaydedilmiş etkinlik geri yüklendi." : "Yeni etkinlik taslağı silindi.");
};
$("formWrap").addEventListener("input", remember);
$("formWrap").addEventListener("change", remember);
$("previewBtn").onclick = () => {
  const e = current();
  $("preview").innerHTML =
    `<h3 class="text-2xl font-bold">${escape(e.title)}</h3><p>${escape(e.date)} · ${escape(e.location)}</p>${image(e.poster)}<p class="whitespace-pre-wrap">${escape(e.description)}</p>`;
  $("preview").hidden = false;
};
$("saveBtn").onclick = async () => {
  if (saving || !authenticated || !editorOpen || [...uploads].some(upload => upload.key === editorKey())) return;
  remember();
  const key = editorKey();
  saving = true;
  draftNotice();
  notify("Kaydediliyor…");
  try {
    const e = current();
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({ event: e }),
    });
    forget(key);
    $("formWrap").classList.add("hidden");
    reset();
    persistDrafts();
    await load();
    notify("Etkinlik kaydedildi.");
  } catch (e) {
    notify(e.message);
  } finally {
    saving = false;
    draftNotice();
  }
};
function upload(single) {
  if (!authenticated || !editorOpen || saving) return;
  if (!window.cloudinary) {
    notify("Görsel yükleme servisine ulaşılamadı. Lütfen tekrar deneyin.");
    return;
  }
  remember();
  const origin = {
    key: editorKey(), id: selectedId, revision: revisions.get(editorKey()) || 0, authGeneration,
    value: eventValue(current(), selectedId), base: structuredClone(savedValue),
  };
  uploads.add(origin);
  draftNotice();
  const finish = () => { uploads.delete(origin); draftNotice(); };
  try {
  window.cloudinary
    .createUploadWidget(
      {
        cloudName: "w2trki15",
        uploadPreset: "ercupsa_gallery",
        sources: ["local"],
        multiple: !single,
        maxFiles: single ? 1 : 50,
        clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
        folder: "ercupsa",
        maxImageWidth: 1600,
        maxImageHeight: 1600,
        maxFileSize: 6000000,
      },
      (error, result) => {
        // A late upload belongs to the event where it started, never the newly selected event.
        if (!authenticated || authGeneration !== origin.authGeneration || (revisions.get(origin.key) || 0) !== origin.revision || (origin.id && !events.some(event => event.id === origin.id))) { finish(); return; }
        if (error) {
          finish();
          notify("Yükleme başarısız. Tamamlanan görseller taslağınızda korundu; kalanları tekrar yükleyebilirsiniz.");
          return;
        }
        if (!result) return;
        if (["close", "abort", "queues-end"].includes(result.event)) finish();
        if (result.event === "success") {
          if (!safeImage(result.info?.secure_url)) { finish(); notify("Yüklenen görsel bağlantısı geçersiz."); return; }
          const p = {
            url: result.info.secure_url,
            publicId: result.info.public_id || "",
            width: Number.isInteger(result.info.width) ? result.info.width : 0,
            height: Number.isInteger(result.info.height) ? result.info.height : 0,
          };
          const active = editorOpen && editorKey() === origin.key;
          const cached = drafts.get(origin.key), latest = origin.id && events.find(event => event.id === origin.id);
          const value = active ? eventValue(current(), selectedId) : structuredClone(cached?.value || (latest ? eventValue(latest, origin.id) : origin.value));
          const base = active ? savedValue : cached?.base || (latest ? eventValue(latest, origin.id) : origin.base);
          if (single) value.poster = p.url;
          else if (value.images.length < 100) value.images.push(p);
          origin.value = structuredClone(value);
          if (!same(value, base)) drafts.set(origin.key, { value, base: structuredClone(base) });
          if (active) { fillEditor(value); remember(); }
          else { persistDrafts(); status("Yüklenen görseller başladığınız etkinliğin taslağına eklendi."); }
          if (single) finish();
        }
      },
    )
    .open();
  } catch {
    finish();
    notify("Görsel yükleme başlatılamadı. Taslağınız korundu; tekrar deneyebilirsiniz.");
  }
}
$("posterBtn").onclick = () => upload(true);
$("photosBtn").onclick = () => upload(false);
async function show() {
  const generation = authGeneration;
  const loaded = await load();
  if (!loaded || generation !== authGeneration) return;
  authenticated = true;
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  const stored = readDrafts();
  if (stored?.active) {
    const id = stored.active === "new" ? "" : stored.active.slice(6);
    edit(id ? events.find(event => event.id === id) : null);
  } else if (drafts.size) {
    status("Kaydedilmemiş etkinlik taslaklarınız korunuyor. İlgili etkinlikte Düzenle ile devam edebilirsiniz.");
  }
  persistDrafts();
  announceAdminReady();
}
$("loginBtn").onclick = async () => {
  if (loggingIn) return;
  loggingIn = true;
  // Invalidate the initial cookie probe before submitting, so its late 401 cannot
  // erase this password or cancel the new authenticated catalog request.
  const generation = ++authGeneration;
  loadVersion++;
  $("loginBtn").disabled = true;
  $("password").disabled = true;
  $("loginError").textContent = "";
  try {
    await api("/api/events?action=auth", {
      method: "POST",
      headers: { "x-admin-password": $("password").value },
    });
    if (generation !== authGeneration) return;
    $("password").value = "";
    await show();
  } catch (e) {
    $("loginError").textContent = e.message;
  } finally {
    loggingIn = false;
    $("loginBtn").disabled = false;
    $("password").disabled = false;
  }
};
$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});
$("adminLogout").onclick = async () => {
  try {
    await api("/api/events?action=logout", { method: "POST" });
    document.dispatchEvent(new Event("admin-logout"));
    location.reload();
  } catch (error) { status(error.message, true); }
};
try { sessionStorage.removeItem("ercupsa_admin_password"); } catch {}
document.addEventListener("admin-logout", clearPrivateDrafts);
window.addEventListener("beforeunload", event => {
  remember();
  if (!authenticated || (!drafts.size && !uploads.size)) return;
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("registration-config-saved", () => load().catch(error => status(error.message, true)));
show().catch(() => {});
