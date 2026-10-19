import { $, api, isOwner, onAdminEvent } from "./common.js";

const host = $("teamEditor");
let ready = false, active = false, loaded = false, busy = false, dirty = false;
let generation = 0, revision = "", members = [];
const previews = new Map();

if (host) {
  host.innerHTML = `<div class="admin-section-heading"><div><h2>Ekibimiz</h2><p>İsimleri, görevleri ve fotoğrafları düzenleyin. Bu alan yalnızca baş yöneticiye açıktır.</p></div></div>
    <form id="teamForm" class="team-admin-panel"><div class="team-admin-toolbar"><div><h3>Ekip kartları</h3><p>Fotoğraflar yüklenmeden önce sıkıştırılır. Kartların sırasını oklarla değiştirebilirsiniz.</p></div><div class="team-admin-actions"><button type="button" id="teamReload">Kaydedileni yükle</button><button type="button" id="teamAdd">Üye ekle</button></div></div><div id="teamMembers" class="team-admin-list"></div><div class="team-admin-footer"><p id="teamMessage" role="status" aria-live="polite"></p><button type="submit" id="teamSave" class="admin-primary">Ekibi kaydet</button></div></form>`;
  function message(value, error = false) { $("teamMessage").textContent = value; $("teamMessage").dataset.error = String(error); }
  function controls() {
    host.querySelectorAll("input,button").forEach(control => { control.disabled = !ready || !isOwner() || !loaded || busy; });
    $("teamReload").disabled = !ready || !isOwner() || busy;
    $("teamSave").disabled = !ready || !isOwner() || !loaded || busy || !dirty;
    members.forEach((member, index) => {
      const card = host.querySelector(`[data-team-id="${member.id}"]`);
      if (card) {
        card.querySelector('[data-action="up"]').disabled ||= index === 0;
        card.querySelector('[data-action="down"]').disabled ||= index === members.length - 1;
      }
    });
  }
  function clearPreviews() { for (const url of previews.values()) URL.revokeObjectURL(url); previews.clear(); }
  function accept(data) {
    const value = data?.team;
    if (!value || !Array.isArray(value.members) || typeof value.revision !== "string") throw Error("Kaydedilmiş ekip listesi doğrulanamadı.");
    members = value.members; revision = value.revision; loaded = true; dirty = false;
    clearPreviews(); render();
  }
  function changed() { dirty = true; message("Kaydedilmemiş değişiklikler var. Ekibi kaydettiğinizde sitede görünür."); controls(); }
  function label(text, input) { const el = document.createElement("label"), title = document.createElement("span"); title.textContent = text; el.append(title, input); return el; }
  function button(text, action, accessible) { const el = document.createElement("button"); el.type = "button"; el.textContent = text; el.dataset.action = action; if (accessible) el.setAttribute("aria-label", accessible); return el; }
  function render() {
    $("teamMembers").replaceChildren(...members.map((member, index) => {
      const card = document.createElement("article"); card.className = "team-admin-card"; card.dataset.teamId = member.id;
      const visual = document.createElement("div"); visual.className = "team-admin-visual";
      const photo = previews.get(member.id) || member.photo;
      if (photo) { const image = document.createElement("img"); image.src = photo; image.alt = member.name || "Ekip fotoğrafı"; image.width = 112; image.height = 112; visual.append(image); }
      else { const placeholder = document.createElement("span"); placeholder.className = "team-admin-placeholder"; placeholder.textContent = (member.name || "E").slice(0, 1); placeholder.setAttribute("aria-hidden", "true"); visual.append(placeholder); }
      const upload = document.createElement("input"); upload.type = "file"; upload.accept = "image/jpeg,image/png,image/webp"; upload.dataset.field = "photo";
      const uploadLabel = label("Fotoğraf yükle", upload); uploadLabel.className = "team-admin-upload";
      const note = document.createElement("small"); note.textContent = "JPG, PNG veya WebP · otomatik sıkıştırma";
      visual.append(uploadLabel, note);
      if (photo) visual.append(button("Fotoğrafı kaldır", "clear-photo"));
      const fields = document.createElement("div"); fields.className = "team-admin-fields";
      const order = document.createElement("span"); order.className = "team-admin-order"; order.textContent = `${index + 1}. kart`;
      const name = document.createElement("input"); name.value = member.name; name.maxLength = 120; name.required = true; name.dataset.field = "name"; name.autocomplete = "off";
      const role = document.createElement("input"); role.value = member.role; role.maxLength = 120; role.required = true; role.dataset.field = "role"; role.autocomplete = "off";
      const featured = document.createElement("input"); featured.type = "checkbox"; featured.checked = member.featured; featured.dataset.field = "featured";
      const featuredLabel = label("Geniş kart (danışman gibi)", featured); featuredLabel.className = "team-admin-featured";
      fields.append(order, label("Ad soyad", name), label("Görev", role), featuredLabel);
      const actions = document.createElement("div"); actions.className = "team-admin-card-actions";
      actions.append(button("↑", "up", `${member.name || "Üye"} bir sıra yukarı`), button("↓", "down", `${member.name || "Üye"} bir sıra aşağı`), button("Üyeyi kaldır", "remove"));
      card.append(visual, fields, actions); return card;
    }));
    if (!members.length) { const empty = document.createElement("p"); empty.className = "team-admin-empty"; empty.textContent = "Ekip listesi boş. Üye ekleyebilir veya boş listeyi kaydedebilirsiniz."; $("teamMembers").append(empty); }
    controls();
  }
  async function load() {
    if (!ready || !isOwner() || busy || !active) return;
    const epoch = generation; busy = true; controls(); message("Ekip bilgileri yükleniyor…");
    try { const data = await api("/api/team?action=admin"); if (epoch !== generation || !ready || !isOwner()) return; accept(data); message("Değişiklikler kaydedilene kadar sitedeki ekip aynı kalır."); }
    catch (error) { if (epoch === generation && ready) message(error.message, true); }
    finally { if (epoch === generation) { busy = false; controls(); } }
  }
  async function compressedPhoto(file) {
    if (!file || !file.size || file.size > 20 * 1024 * 1024) throw Error("En fazla 20 MB bir fotoğraf seçin.");
    let image, close;
    try {
      if (typeof createImageBitmap === "function") { image = await createImageBitmap(file, { imageOrientation: "from-image" }); close = () => image.close(); }
      else {
        const url = URL.createObjectURL(file); image = new Image();
        try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; }); }
        finally { URL.revokeObjectURL(url); }
        close = () => {};
      }
    } catch { throw Error("Fotoğraf açılamadı. JPG, PNG veya WebP olarak yeniden seçin."); }
    try {
      const sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) throw Error("Fotoğraf boyutları okunamadı.");
      const scale = Math.min(1, 800 / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob;
      for (const quality of [0.86, 0.76, 0.64, 0.5, 0.35, 0.2]) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) throw Error("Fotoğraf sıkıştırılamadı. Başka bir fotoğraf deneyin.");
        if (blob.size <= 150 * 1024) return blob;
      }
      throw Error("Fotoğraf yeterince küçültülemedi. Daha sade bir görsel deneyin.");
    } finally { close(); }
  }
  $("teamMembers").addEventListener("input", event => {
    if (!ready || !isOwner() || busy || !loaded) return;
    const card = event.target.closest("[data-team-id]"), member = members.find(item => item.id === card?.dataset.teamId), field = event.target.dataset.field;
    if (!member || !["name", "role", "featured"].includes(field)) return;
    member[field] = field === "featured" ? event.target.checked : event.target.value; changed();
  });
  $("teamMembers").addEventListener("change", async event => {
    if (!ready || !isOwner() || busy || !loaded || event.target.dataset.field !== "photo") return;
    const file = event.target.files?.[0], member = members.find(item => item.id === event.target.closest("[data-team-id]")?.dataset.teamId);
    if (!file || !member) return;
    const epoch = generation; busy = true; controls(); message("Fotoğraf sıkıştırılıyor ve yükleniyor…");
    try {
      const blob = await compressedPhoto(file);
      if (epoch !== generation || !ready || !isOwner()) return;
      const data = await api("/api/team?action=photo", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (epoch !== generation || !ready || !isOwner()) return;
      if (typeof data.photo !== "string" || !/^\/api\/team\?action=photo&id=[a-f0-9]{64}$/.test(data.photo)) throw Error("Yüklenen fotoğraf doğrulanamadı.");
      if (previews.has(member.id)) URL.revokeObjectURL(previews.get(member.id));
      previews.set(member.id, URL.createObjectURL(blob)); member.photo = data.photo; dirty = true;
      render(); message(`Fotoğraf ${Math.ceil(blob.size / 1024)} KB olarak yüklendi. Sitede göstermek için ekibi kaydedin.`);
    } catch (error) { if (epoch === generation && ready) message(error.message, true); }
    finally { if (epoch === generation) { busy = false; event.target.value = ""; controls(); } }
  });
  $("teamMembers").addEventListener("click", event => {
    if (!ready || !isOwner() || busy || !loaded) return;
    const action = event.target.closest("[data-action]")?.dataset.action, card = event.target.closest("[data-team-id]");
    const index = members.findIndex(item => item.id === card?.dataset.teamId);
    if (!action || index < 0) return;
    if (action === "remove") { if (!confirm(`“${members[index].name || "Bu üye"}” ekip listesinden kaldırılsın mı?`)) return; members.splice(index, 1); }
    else if (action === "clear-photo") { members[index].photo = ""; if (previews.has(members[index].id)) URL.revokeObjectURL(previews.get(members[index].id)); previews.delete(members[index].id); }
    else if (action === "up" && index > 0) [members[index - 1], members[index]] = [members[index], members[index - 1]];
    else if (action === "down" && index < members.length - 1) [members[index + 1], members[index]] = [members[index], members[index + 1]];
    else return;
    changed(); render();
  });
  $("teamAdd").onclick = () => {
    if (!ready || !isOwner() || busy || !loaded) return;
    if (members.length >= 100) { message("En fazla 100 ekip üyesi eklenebilir.", true); return; }
    members.push({ id: crypto.randomUUID(), name: "", role: "", photo: "", featured: false }); changed(); render();
    $("teamMembers").lastElementChild.querySelector('[data-field="name"]').focus();
  };
  $("teamReload").onclick = () => { if (!dirty || confirm("Kaydedilmemiş ekip değişiklikleri kaldırılsın ve sunucudaki liste yüklensin mi?")) load(); };
  $("teamForm").onsubmit = async event => {
    event.preventDefault();
    if (!ready || !isOwner() || busy || !loaded || !dirty || !$("teamForm").reportValidity()) return;
    const epoch = generation; busy = true; controls(); message("Ekip kaydediliyor…");
    try {
      const data = await api("/api/team", { method: "PUT", body: JSON.stringify({ members, revision }) });
      if (epoch !== generation || !ready || !isOwner()) return;
      accept(data); message("Ekip kaydedildi. Ekibimiz sayfasında yeni bilgiler gösteriliyor.");
    } catch (error) { if (epoch === generation && ready) message(`${error.message} Değişiklikleriniz bu pencerede korundu.`, true); }
    finally { if (epoch === generation) { busy = false; controls(); } }
  };
  onAdminEvent("admin-ready", () => { ready = isOwner(); controls(); if (ready && active && !loaded) load(); });
  document.addEventListener("admin-tab", event => { active = event.detail === "team" && isOwner(); if (ready && active && !loaded) load(); });
  document.addEventListener("admin-logout", () => { generation++; ready = false; active = false; loaded = false; busy = false; dirty = false; members = []; revision = ""; clearPreviews(); $("teamMembers").replaceChildren(); message(""); controls(); });
  window.addEventListener("beforeunload", event => { if (ready && dirty) { event.preventDefault(); event.returnValue = ""; } });
  controls();
}
