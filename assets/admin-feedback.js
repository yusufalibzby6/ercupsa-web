import { $, escape, api, onAdminEvent } from "./common.js";

let catalog = [], overview = [], entries = [], summary = null;
let selectedId = "", ready = false, active = false, loading = false, visibleLimit = 100;
let detailVersion = 0, overviewVersion = 0;

function endpoint(action, id = "") {
  const query = new URLSearchParams({ action });
  if (id) query.set("eventId", id);
  return `/api/feedback?${query}`;
}
function notice(message, error = false) {
  $("feedbackMessage").textContent = message;
  $("feedbackMessage").dataset.error = String(error);
}
function options() {
  const all = new Map(catalog.map(event => [event.id, event]));
  for (const row of overview) if (row.event?.id && !all.has(row.event.id)) all.set(row.event.id, row.event);
  return [...all.values()];
}
function controls() {
  $("feedbackReload").disabled = !ready || !selectedId || loading;
  $("feedbackOverviewReload").disabled = !ready;
}
function populateEvents() {
  const all = options();
  if (!all.some(event => event.id === selectedId)) selectedId = all[0]?.id || "";
  $("feedbackEvent").innerHTML = all.length ? all.map(event => `<option value="${escape(event.id)}">${escape(event.title || "Etkinlik")}${event.archived ? " (arşiv)" : event.published === false ? " (taslak)" : ""}</option>`).join("") : '<option value="">Henüz etkinlik yok</option>';
  $("feedbackEvent").value = selectedId;
  controls();
}
function renderSummary() {
  $("feedbackSummary").innerHTML = summary ? [["Değerlendirme sayısı", summary.count], ["Ortalama puan", summary.count ? `${Number(summary.average).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} / 5` : "—"]].map(([label, value]) => `<div class="feedback-stat"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join("") : "";
  $("feedbackDistribution").innerHTML = summary ? [5, 4, 3, 2, 1].map(rating => `<div><span>${rating} ★</span><progress max="${Math.max(1, Number(summary.count) || 0)}" value="${Number(summary.distribution?.[rating]) || 0}" aria-label="${rating} puan veren kişi sayısı"></progress><span>${Number(summary.distribution?.[rating]) || 0}</span></div>`).join("") : "";
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });
}
function renderEntries() {
  const search = $("feedbackSearch").value.trim().toLocaleLowerCase("tr"), rating = Number($("feedbackRatingFilter").value);
  const matches = entries.filter(entry => (!rating || entry.rating === rating) && (!search || `${entry.name} ${entry.comment}`.toLocaleLowerCase("tr").includes(search)));
  $("feedbackFilterCount").textContent = `${matches.length} değerlendirme gösteriliyor${matches.length === entries.length ? "" : ` / ${entries.length} değerlendirme`}.`;
  $("feedbackEntries").innerHTML = matches.slice(0, visibleLimit).map(entry => `<article class="feedback-entry"><header><h4>${escape(entry.name || "Katılımcı")}</h4><strong>${Number(entry.rating)} / 5 ★</strong></header><time>${escape(formatDate(entry.updatedAt))}</time><p>${escape(entry.comment || "Yorum bırakılmadı.")}</p></article>`).join("") || '<p class="feedback-empty">Bu filtrelerle eşleşen değerlendirme yok.</p>';
  $("feedbackMore").hidden = matches.length <= visibleLimit;
}
function clearDetails(message = "Bir etkinlik seçin.") {
  entries = []; summary = null; loading = false;
  renderSummary(); $("feedbackFilterCount").textContent = "";
  $("feedbackEntries").textContent = message; $("feedbackMore").hidden = true;
  controls();
}
async function loadSelected() {
  const id = selectedId, version = ++detailVersion;
  clearDetails(id ? "Değerlendirmeler yükleniyor…" : "Henüz değerlendirme yok.");
  if (!ready || !active || !id) return;
  loading = true; controls(); notice("Değerlendirmeler yükleniyor…");
  try {
    const result = await api(endpoint("admin", id));
    if (version !== detailVersion || !ready || !active || selectedId !== id) return;
    if (!Array.isArray(result.entries) || !result.summary) throw new Error("Değerlendirmeler doğrulanamadı. Yeniden deneyin.");
    entries = result.entries; summary = result.summary; visibleLimit = 100;
    renderSummary(); renderEntries(); notice(result.event?.archived ? "Arşivlenmiş etkinliğin değerlendirmeleri gösteriliyor." : "Puanlar ve yorumlar yalnızca yönetim ekibi tarafından görülebilir.");
  } catch (error) {
    if (version !== detailVersion || !ready || !active) return;
    clearDetails("Değerlendirmeler yüklenemedi. Yenile düğmesiyle tekrar deneyin.");
    notice(error.message, true);
  } finally { if (version === detailVersion) { loading = false; controls(); } }
}
function renderOverview() {
  $("feedbackOverview").innerHTML = overview.length ? `<div class="feedback-overview-wrap"><table class="feedback-overview"><caption class="feedback-muted">Etkinliklere göre değerlendirme sayısı ve ortalama puan</caption><thead><tr><th scope="col">Etkinlik</th><th scope="col">Değerlendirme</th><th scope="col">Ortalama</th></tr></thead><tbody>${overview.map(row => `<tr><th scope="row"><button type="button" data-feedback-event="${escape(row.event.id)}">${escape(row.event.title || "Etkinlik")}${row.event.archived ? " (arşiv)" : ""}</button></th><td>${Number(row.count) || 0}</td><td>${row.count ? `${Number(row.average).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} / 5` : "—"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="feedback-empty">Henüz etkinlik yok.</p>';
}
async function loadOverview() {
  if (!ready || !active) return;
  const version = ++overviewVersion;
  $("feedbackOverviewMessage").textContent = "Etkinliklerin değerlendirmeleri yükleniyor…";
  try {
    const result = await api(endpoint("summary"));
    if (version !== overviewVersion || !ready || !active) return;
    if (!Array.isArray(result.events) || result.events.some(row => !row.event?.id)) throw new Error("Karşılaştırma bilgileri doğrulanamadı.");
    overview = result.events;
    const previous = selectedId;
    populateEvents(); renderOverview(); $("feedbackOverviewMessage").textContent = "";
    if (selectedId !== previous) loadSelected();
  } catch (error) {
    if (version === overviewVersion && ready && active) $("feedbackOverviewMessage").textContent = `${error.message} Etkinlikleri yenile düğmesiyle tekrar deneyin.`;
  }
}
$("feedbackEvent").addEventListener("change", () => {
  selectedId = $("feedbackEvent").value;
  $("feedbackSearch").value = ""; $("feedbackRatingFilter").value = "";
  loadSelected();
});
$("feedbackReload").addEventListener("click", () => { loadSelected(); loadOverview(); });
$("feedbackOverviewReload").addEventListener("click", loadOverview);
for (const id of ["feedbackSearch", "feedbackRatingFilter"]) $(id).addEventListener("input", () => { visibleLimit = 100; renderEntries(); });
$("feedbackMore").addEventListener("click", () => { visibleLimit += 100; renderEntries(); });
$("feedbackOverview").addEventListener("click", event => {
  const button = event.target.closest("[data-feedback-event]");
  if (!button) return;
  selectedId = button.dataset.feedbackEvent; $("feedbackEvent").value = selectedId;
  $("feedbackSearch").value = ""; $("feedbackRatingFilter").value = "";
  loadSelected(); $("feedbackEvent").focus();
});
onAdminEvent("events-loaded", event => {
  catalog = Array.isArray(event.detail) ? event.detail : [];
  populateEvents();
  if (ready && active) { loadSelected(); loadOverview(); }
});
onAdminEvent("admin-ready", () => { ready = true; controls(); if (active) { loadSelected(); loadOverview(); } });
document.addEventListener("admin-tab", event => {
  active = event.detail === "feedback";
  if (active && ready) { loadSelected(); loadOverview(); }
  else { detailVersion++; overviewVersion++; loading = false; controls(); }
});
document.addEventListener("admin-logout", () => {
  ready = false; active = false; detailVersion++; overviewVersion++;
  catalog = []; overview = []; selectedId = "";
  clearDetails(); populateEvents(); $("feedbackOverview").textContent = "";
  $("feedbackOverviewMessage").textContent = ""; notice("");
  $("feedbackSearch").value = ""; $("feedbackRatingFilter").value = "";
});
controls();
