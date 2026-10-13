import { $, onAdminEvent } from "./common.js";

let ready = false, active = false, loading = false;
let epoch = 0, listVersion = 0, detailVersion = 0;
let page = 1, pages = 1, search = "", accounts = [];
let selectedId = "", selectedAccount = null;
const mutations = new Map();
const dialog = $("accountDialog");

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}
function message(value, error = false, detail = false) {
  const element = $(detail ? "accountDialogMessage" : "accountsMessage");
  element.textContent = value; element.dataset.error = String(error);
}
async function request(path, options = {}) {
  const auth = epoch;
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (auth === epoch && ready && [401, 403].includes(response.status))
      document.dispatchEvent(new CustomEvent("admin-logout", { detail: { reason: "session-expired" } }));
    throw new Error(data.error || "Kullanıcı bilgileri yüklenemedi. Yeniden deneyin.");
  }
  return data;
}
function controls() {
  for (const id of ["accountsSearch", "accountsSearchButton", "accountsSearchReset", "accountsRefresh"])
    $(id).disabled = !ready || !active || loading;
  $("accountsPrevious").disabled = !ready || !active || loading || page <= 1;
  $("accountsNext").disabled = !ready || !active || loading || page >= pages;
  $("accountVisibilityToggle").disabled = !ready || !active || !selectedAccount || mutations.has(selectedId);
  $("accountDetailRetry").disabled = !ready || !active || mutations.has(selectedId);
}
function account(value) {
  if (!value || typeof value.id !== "string" || typeof value.email !== "string"
    || typeof value.name !== "string" || typeof value.publicName !== "boolean"
    || typeof value.publicNameBlocked !== "boolean")
    throw new Error("Kullanıcı bilgileri doğrulanamadı. Yeniden yükleyin.");
  return value;
}
function fullName(value) { return value.name.trim() || "Ad bilgisi henüz eklenmedi"; }
function consentText(value) {
  if (!value.hasProfile) return "Profil bilgileri henüz tamamlanmadı.";
  return value.publicName ? "Kullanıcı, adının sitede gösterilmesine izin verdi." : "Kullanıcı, adının sitede gösterilmesine izin vermedi.";
}
function dateTime(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
}
function visibility(value) {
  if (value.publicNameBlocked) return ["Yönetici tarafından gizlendi", "blocked"];
  if (!value.publicName) return ["Kullanıcı izni yok", "private"];
  return ["Kullanıcı izni var", "allowed"];
}
function renderList() {
  const rows = accounts.map(value => {
    const row = node("article", "accounts-row");
    const name = node("div", "accounts-name");
    const button = node("button", "accounts-name-button", fullName(value));
    button.type = "button"; button.dataset.accountId = value.id;
    button.addEventListener("click", () => openDetail(value));
    name.append(button, node("span", "accounts-created", `Kayıt: ${dateTime(value.createdAt, false)}`));
    const email = node("div", "accounts-email", value.email || "E-posta bilgisi yok");
    const [label, state] = visibility(value);
    const status = node("div", "accounts-visibility");
    const pill = node("span", "accounts-pill", label); pill.dataset.state = state;
    status.append(pill);
    row.append(name, email, status); return row;
  });
  $("accountsList").replaceChildren(...rows);
  if (!rows.length) $("accountsList").append(node("p", "accounts-empty", search ? "Bu aramaya uygun hesap bulunamadı." : "Henüz siteye kayıt olmuş bir hesap yok."));
}
function clearList() {
  accounts = []; $("accountsList").replaceChildren();
  $("accountsPagination").hidden = true; $("accountsCount").textContent = ""; $("accountsPage").textContent = "";
}
async function loadList(nextPage = page) {
  if (!ready || !active || loading) return;
  const version = ++listVersion, auth = epoch;
  page = nextPage; loading = true; clearList(); controls(); message("Site kullanıcıları yükleniyor…");
  try {
    const params = new URLSearchParams({ page: String(page), search });
    const data = await request(`/api/accounts?${params}`);
    if (version !== listVersion || auth !== epoch || !ready || !active) return;
    if (!Array.isArray(data.accounts) || !Number.isInteger(data.page) || !Number.isInteger(data.pages)
      || !Number.isInteger(data.total) || !Number.isInteger(data.pageSize)) throw new Error("Kullanıcı listesi doğrulanamadı. Yeniden yükleyin.");
    accounts = data.accounts.map(account); page = data.page; pages = Math.max(1, data.pages);
    renderList();
    $("accountsCount").textContent = `${data.total} site hesabı`;
    $("accountsPage").textContent = `${page} / ${pages}`;
    $("accountsPagination").hidden = false;
    message(search ? "Arama sonuçları gösteriliyor." : "Bir isme basarak hesabın etkinlik geçmişini açın.");
  } catch (error) {
    if (version === listVersion && auth === epoch && ready && active) message(error.message, true);
  } finally {
    if (version === listVersion && auth === epoch) { loading = false; controls(); }
  }
}
function clearDetail() {
  detailVersion++; selectedId = ""; selectedAccount = null;
  $("accountDialogTitle").textContent = "Kullanıcı bilgileri";
  for (const id of ["accountEmail", "accountCreatedAt", "accountConsent", "accountModeration", "accountClaimTotal", "accountEntryTotal", "accountCheckinsNote"])
    $(id).textContent = "";
  $("accountEvents").replaceChildren(); $("accountDetail").hidden = true;
  $("accountDetailRetry").hidden = true; message("", false, true); controls();
}
function closeDetail() {
  clearDetail(); if (dialog.open) dialog.close();
}
function renderVisibility() {
  $("accountConsent").textContent = consentText(selectedAccount);
  $("accountModeration").textContent = selectedAccount.publicNameBlocked
    ? "Yönetici engeli açık: Adı sitedeki herkese açık listelerde gösterilmez."
    : "Yönetici engeli yok. Adı, kullanıcının izni ve ilgili listenin katılım koşulları sağlandığında gösterilebilir.";
  $("accountVisibilityToggle").textContent = selectedAccount.publicNameBlocked ? "Yönetici engelini kaldır" : "Sitedeki adı gizle";
  $("accountVisibilityToggle").dataset.blocked = String(selectedAccount.publicNameBlocked);
}
function history(data) {
  return data.attendance.map(event => {
    const card = node("article", "account-event");
    const heading = node("div", "account-event-heading");
    heading.append(node("h4", "", event.title || "Etkinlik"));
    if (event.archived) heading.append(node("span", "accounts-pill", "Arşiv"));
    card.append(heading);
    const metadata = [event.date ? dateTime(`${event.date}T${event.time || "00:00"}:00+03:00`, Boolean(event.time)) : "", event.location || ""].filter(Boolean);
    if (metadata.length) card.append(node("p", "account-event-meta", metadata.join(" · ")));
    const states = node("div", "account-event-states");
    const claim = node("div", "");
    claim.append(node("strong", "", "Bileti hesaba ekleme"), node("span", "", event.claimedAt ? dateTime(event.claimedAt) : "Hesaba ekleme kaydı yok"));
    const entry = node("div", "");
    entry.append(node("strong", "", "Kapıda giriş"), node("span", "", event.enteredAt ? dateTime(event.enteredAt) : data.checkinsAvailable ? "Giriş kaydı yok" : "Giriş durumu doğrulanamadı"));
    states.append(claim, entry); card.append(states); return card;
  });
}
async function loadDetail(id) {
  const version = ++detailVersion, auth = epoch;
  selectedAccount = null; $("accountDetail").hidden = true; $("accountDetailRetry").hidden = true;
  controls(); message("Hesap ve etkinlik geçmişi yükleniyor…", false, true);
  try {
    const data = await request(`/api/accounts?userId=${encodeURIComponent(id)}`);
    if (auth !== epoch || version !== detailVersion || id !== selectedId || !ready || !active || !dialog.open) return;
    const current = account(data.account);
    if (current.id !== id || !Array.isArray(data.attendance) || !Number.isInteger(data.claimTotal)
      || (data.checkinsAvailable && !Number.isInteger(data.entryTotal)) || typeof data.checkinsAvailable !== "boolean")
      throw new Error("Hesap geçmişi doğrulanamadı. Yeniden yükleyin.");
    selectedAccount = current;
    $("accountDialogTitle").textContent = fullName(current);
    $("accountEmail").textContent = current.email || "E-posta bilgisi yok";
    $("accountCreatedAt").textContent = dateTime(current.createdAt);
    $("accountClaimTotal").textContent = String(data.claimTotal);
    $("accountEntryTotal").textContent = data.checkinsAvailable ? String(data.entryTotal) : "Doğrulanamadı";
    $("accountCheckinsNote").textContent = data.checkinsAvailable
      ? "Bu liste hesabın QR katılımlarını ve doğrulanmış kapı girişlerini ayrı gösterir."
      : "Kapı girişleri şu anda doğrulanamıyor. Bu, kişinin etkinliğe gelmediği anlamına gelmez.";
    $("accountEvents").replaceChildren(...history(data));
    if (!data.attendance.length) $("accountEvents").append(node("p", "accounts-empty", "Bu hesap için henüz etkinlik geçmişi yok."));
    renderVisibility(); $("accountDetail").hidden = false; message("", false, true);
  } catch (error) {
    if (auth === epoch && version === detailVersion && id === selectedId && ready && active && dialog.open) {
      message(error.message, true, true); $("accountDetailRetry").hidden = false;
    }
  } finally { if (auth === epoch && version === detailVersion) controls(); }
}
function openDetail(value) {
  if (!ready || !active) return;
  closeDetail(); selectedId = value.id;
  $("accountDialogTitle").textContent = fullName(value);
  dialog.showModal(); loadDetail(value.id);
}
$("accountsSearchForm").addEventListener("submit", event => {
  event.preventDefault(); if (!ready || !active || loading) return;
  closeDetail(); search = $("accountsSearch").value.trim(); loadList(1);
});
$("accountsSearchReset").addEventListener("click", () => {
  if (!ready || !active || loading) return;
  closeDetail(); search = ""; $("accountsSearch").value = ""; loadList(1);
});
$("accountsRefresh").addEventListener("click", () => { closeDetail(); loadList(); });
$("accountsPrevious").addEventListener("click", () => { if (page > 1) loadList(page - 1); });
$("accountsNext").addEventListener("click", () => { if (page < pages) loadList(page + 1); });
$("accountDialogClose").addEventListener("click", closeDetail);
dialog.addEventListener("cancel", event => { event.preventDefault(); closeDetail(); });
dialog.addEventListener("close", () => { if (!dialog.open && selectedId) clearDetail(); });
$("accountDetailRetry").addEventListener("click", () => { if (selectedId && ready && active) loadDetail(selectedId); });
$("accountVisibilityToggle").addEventListener("click", async () => {
  if (!ready || !active || !selectedAccount || mutations.has(selectedId)) return;
  const id = selectedId, hidden = !selectedAccount.publicNameBlocked;
  const text = hidden
    ? "Bu kullanıcının adını sitedeki herkese açık listelerden gizlemek istiyor musunuz? Hesabı, izni, biletleri ve geçmişi korunur. Kullanıcı yönetici engelini kendi profilinden kaldıramaz."
    : "Bu kullanıcının adına uygulanan yönetici engeli kaldırılsın mı? Kullanıcının görünürlük izni değişmez; izin vermediyse adı gizli kalır.";
  if (!confirm(text)) return;
  const auth = epoch, version = detailVersion, list = listVersion, token = Symbol(id);
  mutations.set(id, token); controls(); message("Adın görünürlük ayarı kaydediliyor…", false, true);
  try {
    const data = await request("/api/accounts?action=visibility", { method: "POST", body: JSON.stringify({ userId: id, hidden }) });
    if (auth !== epoch || version !== detailVersion || id !== selectedId || !ready || !active || !dialog.open) return;
    if (data.ok !== true || data.userId !== id || data.publicNameBlocked !== hidden) throw new Error("Görünürlük ayarı doğrulanamadı. Bilgileri yeniden yükleyin.");
    selectedAccount = { ...selectedAccount, publicNameBlocked: hidden }; renderVisibility();
    if (list === listVersion) {
      accounts = accounts.map(value => value.id === id ? { ...value, publicNameBlocked: hidden } : value); renderList();
    }
    message(hidden ? "Adı sitedeki herkese açık listelerde gizlendi." : "Yönetici engeli kaldırıldı. Kullanıcının görünürlük izni korundu.", false, true);
  } catch (error) {
    if (auth === epoch && version === detailVersion && id === selectedId && ready && active && dialog.open) {
      message(`${error.message} Güncel durumu kontrol etmek için bilgileri yeniden yükleyin.`, true, true);
      $("accountDetailRetry").hidden = false;
    }
  } finally {
    if (mutations.get(id) === token) mutations.delete(id);
    if (auth === epoch) {
      controls();
      if (version !== detailVersion && id === selectedId && ready && active && dialog.open) loadDetail(id);
    }
  }
});
onAdminEvent("admin-ready", () => { ready = true; controls(); if (active) loadList(); });
document.addEventListener("admin-tab", event => {
  const nextActive = event.detail === "accounts";
  if (nextActive === active) return;
  active = nextActive; listVersion++; loading = false; closeDetail(); clearList(); message(""); controls();
  if (active && ready) loadList();
});
document.addEventListener("admin-logout", () => {
  epoch++; listVersion++; ready = false; active = false; loading = false; page = 1; pages = 1; search = "";
  mutations.clear(); $("accountsSearch").value = ""; closeDetail(); clearList(); message(""); controls();
});
controls();
