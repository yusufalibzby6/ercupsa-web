import { $, escape, api, safeImage, status } from "./common.js";
let events = [],
  photos = [],
  poster = "",
  selectedId = "";
const fields = [
  "title",
  "category",
  "date",
  "time",
  "location",
  "registrationUrl",
  "description",
];
function notify(s) {
  $("saveStatus").textContent = s;
}
function image(url, cls = "w-24 h-24 object-cover rounded-xl") {
  const src = safeImage(url);
  return src ? `<img src="${src}" alt="Etkinlik görseli" class="${cls}">` : "";
}
async function load() {
  const d = await api("/api/events?admin=true");
  events = d.events;
  render();
  document.dispatchEvent(new CustomEvent("events-loaded", { detail: events }));
}
function render() {
  const q = $("eventSearch").value.toLocaleLowerCase("tr");
  $("eventsList").innerHTML =
    events
      .filter((e) => e.title.toLocaleLowerCase("tr").includes(q))
      .map(
        (e) =>
          `<article class="card p-5 rounded-3xl flex flex-wrap justify-between gap-4"><div class="flex gap-4">${image(e.poster)}<div><p class="text-sm">${escape(e.category)} · ${escape(e.date)} · ${e.published ? "Yayında" : "Taslak"}</p><h3 class="font-bold text-xl">${escape(e.title)}</h3><p>${escape(e.location)} ${escape(e.time)}</p><p>${e.images.length} fotoğraf</p></div></div><div class="flex flex-wrap gap-2 items-center"><button data-action="publish" data-id="${escape(e.id)}" class="border rounded-xl p-2">${e.published ? "Yayından kaldır" : "Yayınla"}</button><button data-action="edit" data-id="${escape(e.id)}" class="border rounded-xl p-2">Düzenle</button><button data-action="ticket" data-id="${escape(e.id)}" class="border rounded-xl p-2">Bilet oluştur</button><button data-action="delete" data-id="${escape(e.id)}" class="text-red-700 p-2">Sil</button></div></article>`,
      )
      .join("") || "<p>Etkinlik bulunamadı.</p>";
}
function reset() {
  selectedId = "";
  fields.forEach((f) => ($(f).value = ""));
  $("published").checked = false;
  poster = "";
  photos = [];
  thumbs();
  $("preview").hidden = true;
}
function edit(e) {
  selectedId = e.id;
  fields.forEach((f) => ($(f).value = e[f] || ""));
  $("published").checked = e.published;
  poster = e.poster;
  photos = structuredClone(e.images);
  thumbs();
  $("formWrap").classList.remove("hidden");
  $("formTitle").textContent = "Etkinliği düzenle";
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
  b.disabled = true;
  try {
    if (b.dataset.action === "edit") edit(e);
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
});
$("eventSearch").addEventListener("input", render);
$("newBtn").onclick = () => {
  reset();
  $("formTitle").textContent = "Yeni etkinlik";
  $("formWrap").classList.remove("hidden");
};
$("cancelBtn").onclick = () => {
  if (confirm("Kaydedilmemiş düzenlemeleri kapatmak istiyor musun?"))
    $("formWrap").classList.add("hidden");
};
$("previewBtn").onclick = () => {
  const e = current();
  $("preview").innerHTML =
    `<h3 class="text-2xl font-bold">${escape(e.title)}</h3><p>${escape(e.date)} · ${escape(e.location)}</p>${image(e.poster)}<p class="whitespace-pre-wrap">${escape(e.description)}</p>`;
  $("preview").hidden = false;
};
$("saveBtn").onclick = async () => {
  const b = $("saveBtn");
  b.disabled = true;
  notify("Kaydediliyor…");
  try {
    const e = current();
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({ event: e }),
    });
    $("formWrap").classList.add("hidden");
    reset();
    await load();
    notify("Etkinlik kaydedildi.");
  } catch (e) {
    notify(e.message);
  } finally {
    b.disabled = false;
  }
};
function upload(single) {
  if (!window.cloudinary) {
    notify("Görsel yükleme servisine ulaşılamadı. Lütfen tekrar deneyin.");
    return;
  }
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
        if (error) {
          notify("Yükleme başarısız.");
          return;
        }
        if (result.event === "success") {
          const p = {
            url: result.info.secure_url,
            publicId: result.info.public_id,
            width: result.info.width,
            height: result.info.height,
          };
          if (single) poster = p.url;
          else if (photos.length < 100) photos.push(p);
          thumbs();
        }
      },
    )
    .open();
}
$("posterBtn").onclick = () => upload(true);
$("photosBtn").onclick = () => upload(false);
async function show() {
  await load();
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.dispatchEvent(new Event("admin-ready"));
}
$("loginBtn").onclick = async () => {
  try {
    await api("/api/events?action=auth", {
      method: "POST",
      headers: { "x-admin-password": $("password").value },
    });
    $("password").value = "";
    await show();
  } catch (e) {
    $("loginError").textContent = e.message;
  }
};
$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});
$("adminLogout").onclick = async () => {
  await api("/api/events?action=logout", { method: "POST" });
  location.reload();
};
sessionStorage.removeItem("ercupsa_admin_password");
show().catch(() => {});
