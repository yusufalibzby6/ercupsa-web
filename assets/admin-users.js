import { $, escape, api, onAdminEvent, isOwner } from "./common.js";

const groups = [
  ["events", "Etkinlikler", [["view", "Görüntüle"], ["manage", "Oluştur ve düzenle"], ["publish", "Yayınla / yayından kaldır"]]],
  ["registrations", "Kayıt formları", [["view", "Kayıtları görüntüle"], ["manage", "Formu ve kayıtları düzenle"], ["receipts", "Dekontları görüntüle"], ["photos", "Gönderilen fotoğrafları görüntüle"], ["export", "Excel / CSV indir"]]],
  ["tickets", "Biletler", [["view", "Görüntüle ve yazdır"], ["manage", "Bilet oluştur, iptal et ve tasarım değiştir"]]],
  ["raffles", "Çekilişler", [["view", "Görüntüle"], ["manage", "Çekiliş yap ve sonuçları yönet"]]],
  ["attendance", "Giriş ve katılım", [["view", "Katılımı görüntüle"], ["manage", "Bilet okut ve giriş kaydet"]]],
  ["accounts", "Site kullanıcıları", [["view", "Bilgileri görüntüle"], ["manage", "Adların sitede görünürlüğünü yönet"]]],
  ["instagram", "Instagram", [["view", "Görüntüle"], ["manage", "Paylaşım bağlantılarını değiştir"]]],
];
let ready = false, active = false, generation = 0, loadVersion = 0;
let accounts = [], revision = "", selectedId = "", busy = false, loaded = false;
const fields = ["adminUserName", "adminUserUsername", "adminUserPassword", "adminUserActive"];
function message(text, error = false) { $("adminUsersMessage").textContent = text; $("adminUsersMessage").dataset.error = String(error); }
const selected = () => accounts.find(account => account.id === selectedId);
function renderPermissions(chosen = []) {
  const values = new Set(chosen);
  $("adminUserPermissionGroups").innerHTML = groups.map(([module, title, permissions]) => `<section class="admin-user-permission-group"><h4>${title}</h4><div>${permissions.map(([action, label]) => {
    const key = `${module}.${action}`;
    return `<label><input type="checkbox" data-permission="${key}" ${values.has(key) ? "checked" : ""}><span>${label}</span></label>`;
  }).join("")}</div></section>`).join("");
}
function controls() {
  const account = selected(), fixed = account?.fixedPreset === true;
  $("adminUserPassword").required = !account || (!account.hasPassword && $("adminUserActive").checked);
  for (const id of fields) $(id).disabled = !ready || !loaded || busy || (id === "adminUserUsername" && fixed);
  $("adminUserPermissions").disabled = !ready || !loaded || busy || fixed;
  for (const id of ["adminUsersReload", "adminUserNew", "adminUserSave", "adminUserCancel", "adminUserDelete"]) $(id).disabled = !ready || busy || (id !== "adminUsersReload" && !loaded);
  $("adminUsersList").querySelectorAll("button").forEach(button => { button.disabled = !ready || busy; });
}
function renderList() {
  $("adminUsersList").innerHTML = accounts.map(account => `<button type="button" class="admin-user-card${account.id === selectedId ? " is-selected" : ""}" data-admin-user="${escape(account.id)}" aria-pressed="${account.id === selectedId}"><span class="admin-user-card-heading"><strong>${escape(account.name || account.username)}</strong><span class="admin-user-badge${account.active ? "" : " is-inactive"}">${account.active ? "Aktif" : "Kapalı"}</span></span><span>@${escape(account.username)} · ${account.fixedPreset ? "Sayman" : "Yönetici"}</span><small>${account.fixedPreset ? "Kayıtlar ve dekontlar · salt okunur" : account.permissions?.length ? `${account.permissions.length} erişim izni` : "Bölüm izni verilmemiş"}${account.hasPassword ? "" : " · Şifre bekliyor"}</small></button>`).join("") || '<p class="admin-user-note">Henüz başka yönetici yok.</p>';
  controls();
}
function edit(account) {
  if (!ready || busy) return;
  selectedId = account?.id || "";
  $("adminUserEditorHeading").textContent = account ? `${account.name || account.username} · Hesabı düzenle` : "Yeni yönetici";
  $("adminUserName").value = account?.name || "";
  $("adminUserUsername").value = account?.username || "";
  $("adminUserPassword").value = "";
  $("adminUserActive").checked = account ? account.active === true : true;
  $("adminUserPresetNote").hidden = !account?.fixedPreset;
  $("adminUserDelete").hidden = !account || account.fixedPreset;
  $("adminUserSave").textContent = account ? "Değişiklikleri kaydet" : "Hesabı oluştur";
  renderPermissions(account?.permissions || []);
  renderList();
}
function accept(data) {
  if (!Array.isArray(data.accounts) || typeof data.revision !== "string" || !data.revision) throw new Error("Yönetici hesapları sunucudan doğrulanamadı.");
  accounts = data.accounts.filter(account => account && typeof account.id === "string" && typeof account.username === "string" && ["admin", "treasurer"].includes(account.role));
  revision = data.revision; loaded = true;
}
async function load() {
  if (!ready || !active || busy) return;
  const epoch = generation, version = ++loadVersion;
  busy = true; controls(); message("Yönetici hesapları yükleniyor…");
  try {
    const data = await api("/api/admin-users");
    if (!ready || epoch !== generation || version !== loadVersion) return;
    accept(data); busy = false;
    edit(accounts.find(account => account.id === selectedId) || null);
    message("Hesap şifreleri gösterilmez. Hesabı kapatmak veya şifresini değiştirmek mevcut oturumlarını da geçersiz yapar.");
  } catch (error) { if (epoch === generation && version === loadVersion && ready) message(error.message, true); }
  finally { if (epoch === generation && version === loadVersion) { busy = false; controls(); } }
}
onAdminEvent("admin-ready", () => { ready = isOwner(); controls(); if (ready && active) load(); });
document.addEventListener("admin-tab", event => {
  active = event.detail === "adminUsers";
  if (active && ready && !loaded) load();
});
$("adminUsersReload").onclick = load;
$("adminUserNew").onclick = () => edit(null);
$("adminUserCancel").onclick = () => edit(null);
$("adminUserActive").addEventListener("change", controls);
$("adminUsersList").addEventListener("click", event => {
  const button = event.target.closest("[data-admin-user]");
  if (button) edit(accounts.find(account => account.id === button.dataset.adminUser));
});
$("adminUserPermissions").addEventListener("change", event => {
  const checkbox = event.target.closest("[data-permission]");
  if (!checkbox || !ready || busy || selected()?.fixedPreset) return;
  const [module, action] = checkbox.dataset.permission.split(".");
  if (checkbox.checked && action !== "view") $("adminUserPermissions").querySelector(`[data-permission="${module}.view"]`).checked = true;
  if (!checkbox.checked && action === "view") $("adminUserPermissions").querySelectorAll(`[data-permission^="${module}."]`).forEach(input => { input.checked = false; });
});
$("adminUserForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!ready || !isOwner() || !loaded || busy || !$("adminUserForm").reportValidity()) return;
  const account = selected(), id = selectedId, epoch = generation;
  const password = $("adminUserPassword").value;
  const payload = { ...(id ? { id } : {}), name: $("adminUserName").value.trim(), active: $("adminUserActive").checked,
    expectedRevision: revision, ...(!account?.fixedPreset ? { username: $("adminUserUsername").value.trim(), permissions: [...$("adminUserPermissions").querySelectorAll("[data-permission]:checked")].map(input => input.dataset.permission) } : {}), ...(password ? { password } : {}) };
  busy = true; controls(); message("Hesap kaydediliyor…");
  try {
    const data = await api("/api/admin-users", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    if (!ready || epoch !== generation) return;
    accept(data); busy = false;
    edit(accounts.find(item => item.id === (data.account?.id || id)) || null);
    message(id ? "Hesap güncellendi. Yeni izinler sonraki girişte kullanılır; önceki oturumlar kapatıldı." : "Yönetici hesabı oluşturuldu. Kullanıcı adı ve şifreyle giriş yapabilir.");
  } catch (error) {
    if (epoch === generation && ready) { $("adminUserPassword").value = ""; message(`${error.message} Listeyi yenileyip yeniden deneyebilirsiniz.`, true); }
  } finally { if (epoch === generation) { busy = false; controls(); } }
});
$("adminUserDelete").onclick = async () => {
  const account = selected();
  if (!ready || !isOwner() || !loaded || busy || !account || account.fixedPreset || !confirm(`“${account.name || account.username}” yönetici hesabı silinsin mi? Mevcut oturumları kapatılır.`)) return;
  const epoch = generation;
  busy = true; controls(); message("Hesap siliniyor…");
  try {
    const data = await api(`/api/admin-users?id=${encodeURIComponent(account.id)}&expectedRevision=${encodeURIComponent(revision)}`, { method: "DELETE" });
    if (!ready || epoch !== generation) return;
    accept(data); busy = false; edit(null); message("Yönetici hesabı silindi.");
  } catch (error) { if (epoch === generation && ready) message(error.message, true); }
  finally { if (epoch === generation) { busy = false; controls(); } }
};
document.addEventListener("admin-logout", () => {
  generation++; loadVersion++; ready = false; active = false; busy = false; loaded = false;
  accounts = []; revision = ""; selectedId = "";
  $("adminUsersList").replaceChildren(); $("adminUserPermissionGroups").replaceChildren();
  $("adminUserForm").reset(); $("adminUserPassword").value = "";
  message(""); controls();
});
renderPermissions(); controls();
