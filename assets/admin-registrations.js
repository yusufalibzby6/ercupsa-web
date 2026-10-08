import { $, escape, api, onAdminEvent } from "./common.js";
import QRCode from "qrcode";
import { ticketCard, printTickets } from "./ticket-print.js";
import { validateStoredDesign, releaseTicketArtwork } from "./ticket-template.js";

const CORE_IDS = new Set(["full_name", "class_year", "phone"]);
const CLASS_OPTIONS = ["Hazırlık", "1. Sınıf", "2. Sınıf", "3. Sınıf", "4. Sınıf", "5. Sınıf", "Mezun", "Diğer"];
const TYPE_LABELS = { text: "Kısa cevap", textarea: "Uzun cevap", email: "E-posta", tel: "Telefon", select: "Açılır liste", radio: "Tek seçim", checkboxes: "Çoklu seçim" };
const OPTION_TYPES = new Set(["select", "radio", "checkboxes"]);
const drafts = new Map();
const busyEntries = new Set();
const entryFeedback = new Map();
const deleteConfirmations = new Set();
let events = [], selectedId = "", ready = false, loading = false, saving = false;
let loadVersion = 0, summaryVersion = 0, receiptVersion = 0, ticketVersion = 0;
let entries = [], summary = null, eventInfo = null, comparison = [], visibleLimit = 100;
let receiptUrl = null, receiptOpener = null;
const comparisonSelection = new Set();
let ticketOpener = null, activeTicket = null, pendingTicketDeletions = [];
let ticketPrintAbort = null;

function catalog() {
  const result = new Map(events.map(event => [event.id, event]));
  for (const item of comparison) if (!result.has(item.eventId)) result.set(item.eventId, {
    id: item.eventId, title: item.title, date: item.date || "", archived: true, published: false,
  });
  return [...result.values()];
}
function archived() { return !!(eventInfo?.archived || catalog().find(event => event.id === selectedId)?.archived); }

function defaultForm(eventId) {
  return { eventId, enabled: true, maxRegistrations: null, description: "", fields: [
    { id: "full_name", type: "text", label: "Ad soyad", required: true },
    { id: "class_year", type: "select", label: "Sınıf", required: true, options: [...CLASS_OPTIONS] },
    { id: "phone", type: "tel", label: "Telefon", required: true },
  ], receipt: { enabled: true, required: false } };
}
function endpoint(action, eventId = selectedId, extras = {}) {
  const params = new URLSearchParams({ action, ...extras });
  if (eventId) params.set("event_id", eventId);
  return `/api/registrations?${params}`;
}
function feedback(message, error = false) {
  $("registrationFeedback").textContent = message;
  $("registrationFeedback").dataset.error = String(error);
}
function stableForm(form) {
  const result = { eventId: form.eventId, enabled: !!form.enabled, maxRegistrations: form.maxRegistrations == null ? null : Number(form.maxRegistrations), description: String(form.description || ""), fields: form.fields.map((field) => ({ id: field.id, type: field.type, label: field.label, required: !!field.required, ...(OPTION_TYPES.has(field.type) ? { options: [...(field.options || [])] } : {}) })), receipt: { enabled: !!form.receipt?.enabled, required: !!form.receipt?.enabled && !!form.receipt?.required } };
  result.fields.find((field) => field.id === "full_name").required = true;
  return result;
}
function getDraft() { return drafts.get(selectedId); }
function hasUnsaved() { const draft = getDraft(); return !!draft && JSON.stringify(stableForm(draft.form)) !== draft.saved; }
function updateControls() {
  const draft = getDraft();
  $("registrationConfigFields").disabled = !draft || saving || loading || archived();
  $("registrationEvent").disabled = saving;
  $("registrationEventScope").disabled = saving;
  $("registrationSave").disabled = !draft || saving || loading || archived();
  $("registrationAddField").disabled = !draft || saving || loading || archived() || draft.form.fields.length >= 25;
  $("registrationDiscard").hidden = !hasUnsaved();
  $("registrationDiscard").disabled = saving || loading;
  $("registrationReceiptRequired").disabled = !draft?.form.receipt.enabled || saving || loading;
  $("registrationExport").disabled = !selectedId || loading;
  $("registrationReload").disabled = !selectedId || loading || saving;
  $("registrationDraftNotice").hidden = !hasUnsaved();
  $("registrationRetry").hidden = !selectedId || !$("registrationEntries").dataset.error;
}
function changed() {
  const draft = getDraft();
  if (!draft) return;
  feedback("Değişiklikler henüz kaydedilmedi. Etkinlik değiştirseniz de bu sekmede korunur.");
  updateControls();
}
function renderFields() {
  const fields = getDraft()?.form.fields || [];
  $("registrationFields").innerHTML = fields.map((field, index) => {
    const core = CORE_IDS.has(field.id), id = escape(field.id);
    return `<article class="registration-field" data-registration-field="${id}"><div class="registration-field-top"><strong>${index + 1}. ${core ? "Temel bilgi" : "Ek soru"}</strong>${core ? '<span class="registration-muted">Her formda bulunur</span>' : `<div class="registration-field-actions"><button type="button" data-field-move="-1" aria-label="Soruyu yukarı taşı" ${index <= 3 ? "disabled" : ""}>↑</button><button type="button" data-field-move="1" aria-label="Soruyu aşağı taşı" ${index === fields.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-field-remove aria-label="Soruyu kaldır">Kaldır</button></div>`}</div><label>Soru başlığı<input data-field-prop="label" value="${escape(field.label)}" maxlength="160" required></label><label>Cevap türü<select data-field-prop="type" ${core ? "disabled" : ""}>${Object.entries(TYPE_LABELS).map(([type, label]) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="registration-check"><input type="checkbox" data-field-prop="required" ${field.required ? "checked" : ""} ${field.id === "full_name" ? "disabled" : ""}>Zorunlu alan${field.id === "full_name" ? " (ad soyad her zaman zorunlu)" : ""}</label>${OPTION_TYPES.has(field.type) ? `<label class="registration-options">Seçenekler <span class="registration-muted">(her satıra bir seçenek)</span><textarea data-field-prop="options" rows="${Math.min(Math.max(field.options?.length || 2, 2), 5)}" required>${escape((field.options || []).join("\n"))}</textarea></label>` : ""}</article>`;
  }).join("");
}
function renderForm() {
  const draft = getDraft();
  if (!draft) { $("registrationFields").innerHTML = ""; updateControls(); return; }
  $("registrationEnabled").checked = !!draft.form.enabled;
  $("registrationMaxRegistrations").value = draft.form.maxRegistrations ?? "";
  $("registrationDescription").value = draft.form.description || "";
  $("registrationReceiptEnabled").checked = !!draft.form.receipt?.enabled;
  $("registrationReceiptRequired").checked = !!draft.form.receipt?.required;
  renderFields();
  const current = eventInfo || events.find((event) => event.id === selectedId);
  $("registrationEventNote").textContent = archived() ? "Arşivlenmiş etkinlik: cevapları, dekontları ve verilmiş biletleri inceleyebilirsiniz. Form düzenleme ve yeni bilet verme kapalıdır." : current?.published === false ? "Etkinlik taslakta. Formu hazırlayabilirsiniz; katılımcılara açılması için etkinliği de yayımlayın." : "Form açıkken katılımcılar etkinliğin kendi bağlantısından kayıt olabilir. Geçmiş günlerin formları yeni kayıt almaz.";
  updateControls();
}
function classCompare(a, b) { return a.localeCompare(b, "tr", { numeric: true }); }
function savedLimit() { return getDraft()?.savedForm.maxRegistrations ?? null; }
function isAtLimit() { const limit = savedLimit(); return limit != null && summary != null && Number(summary.total) >= limit; }
function renderStats() {
  const limit = savedLimit();
  $("registrationSummary").innerHTML = summary ? [["Toplam kayıt", Number(summary.total) || 0], ["Kayıt üst sınırı", limit ?? "Sınırsız"], ["Olası tekrar kayıt", Number(summary.duplicateEntries) || 0], ["Bilet verilmiş", entries.filter(entry => entry.ticket?.status === "issued").length]].map(([label, value]) => `<div class="registration-stat"><span>${label}</span><strong>${escape(value)}</strong></div>`).join("") : "";
  $("registrationCapacityInfo").dataset.full = String(isAtLimit());
  $("registrationCapacityInfo").textContent = !summary ? "" : isAtLimit() ? "Kontenjan doldu. Form yeni kayıt alımına otomatik kapalı." : limit != null ? `Toplam ${Number(summary.total) || 0} kayıt var; kayıt üst sınırı ${limit}.` : "Bu formda kayıt üst sınırı yok.";
  $("registrationClassBreakdown").innerHTML = (summary?.byClass || []).slice().sort((a, b) => classCompare(a.classYear, b.classYear)).map((group) => `<span class="registration-class-chip">${escape(group.classYear || "Belirtilmedi")}: <strong>${Number(group.count) || 0}</strong></span>`).join("");
  const previous = $("registrationClassFilter").value;
  const classes = [...new Set(entries.map((entry) => entry.classYear || "Belirtilmedi"))].sort(classCompare);
  $("registrationClassFilter").innerHTML = '<option value="">Tüm sınıflar</option>' + classes.map((classYear) => `<option value="${escape(classYear)}">${escape(classYear)}</option>`).join("");
  if (classes.includes(previous)) $("registrationClassFilter").value = previous;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });
}
function answerRows(entry) {
  const fields = entry.fields || getDraft()?.form.fields || [];
  const labels = new Map(fields.map((field) => [field.id, field.label]));
  return Object.entries(entry.answers || {}).map(([id, value]) => `<dt>${escape(labels.get(id) || id)}</dt><dd>${escape(Array.isArray(value) ? value.join(", ") : value || "—")}</dd>`).join("");
}
function entryMarkup(entry) {
  const id = escape(entry.id), busy = busyEntries.has(entry.id) ? "disabled" : "";
  const ticket = entry.ticket, issued = ticket?.status === "issued";
  const ticketLabel = issued ? "Bileti görüntüle" : ticket ? "Bileti tamamla / yeniden dene" : "Bilet ver";
  const ticketDisabled = busy || (archived() && !issued ? "disabled" : "");
  const duplicate = entry.possibleDuplicate ? `<p class="registration-duplicate">Olası tekrar: aynı telefonla ${Number(entry.duplicateCount) || 2} kayıt var. Cevapları karşılaştırıp gereksiz kaydı silebilirsiniz.</p>` : "";
  const confirm = deleteConfirmations.has(entry.id) ? `<span class="registration-delete-prompt">Bu kayıt ve dekontu silinsin mi?${ticket ? " Verilmiş QR bileti de iptal edilir; önceki katılım geçmişi korunur." : ""}<button type="button" class="registration-delete-confirm" data-registration-delete-confirm="${id}" ${busy}>Sil</button><button type="button" data-registration-delete-cancel="${id}" ${busy}>Vazgeç</button></span>` : `<button type="button" class="registration-delete" data-registration-delete="${id}" ${busy}>Kaydı sil</button>`;
  return `<article class="registration-entry" data-registration-entry="${id}"><div class="registration-entry-head"><div><h4>${escape(entry.name || "İsimsiz kayıt")}</h4><div class="registration-entry-meta"><span>${escape(entry.classYear || "Sınıf belirtilmedi")}</span><span>${escape(entry.phone || "Telefon belirtilmedi")}</span><span>${escape(formatDate(entry.createdAt))}</span></div></div><span class="registration-ticket-state">${issued ? "Bilet verilmiş" : ticket ? "Bilet hazırlanıyor" : "Bilet verilmemiş"}</span></div>${duplicate}<details><summary>Cevapları göster</summary><dl class="registration-answers">${answerRows(entry)}</dl><p class="registration-muted">Kayıt referansı: ${id}</p></details><div class="registration-actions"><button type="button" class="registration-primary" data-registration-ticket="${id}" ${ticketDisabled}>${ticketLabel}</button>${entry.receipt ? `<button type="button" data-registration-receipt="${id}" ${busy}>Dekontu görüntüle</button>` : '<span class="registration-muted">Dekont yüklenmedi</span>'}${confirm}</div><p class="registration-feedback" data-entry-feedback="${id}" data-error="${!!entryFeedback.get(entry.id)?.error}" role="status">${escape(entryFeedback.get(entry.id)?.message || "")}</p></article>`;
}
function pendingDeletionMarkup() {
  if (!pendingTicketDeletions.length) return "";
  return `<section class="registration-cleanup" aria-label="Tamamlanmamış bilet iptalleri"><h4>Bilet iptali tamamlanmayı bekliyor</h4><p>Kayıt silindi; bağlantı hatası nedeniyle QR iptali henüz doğrulanamadı. Aşağıdaki düğmeyle aynı işlemi tamamlayın.</p>${pendingTicketDeletions.map(item => `<div><span>${escape(item.name || "Silinen kayıt")}</span><button type="button" data-registration-cleanup="${escape(item.id)}" ${busyEntries.has(item.id) ? "disabled" : ""}>Bilet iptalini tamamla</button><p class="registration-feedback" role="status">${escape(entryFeedback.get(item.id)?.message || "")}</p></div>`).join("")}</section>`;
}
function renderEntries() {
  if (loading) return;
  const search = $("registrationSearch").value.trim().toLocaleLowerCase("tr"), filterClass = $("registrationClassFilter").value, recordFilter = $("registrationRecordFilter").value;
  const matches = entries.filter((entry) => (!filterClass || (entry.classYear || "Belirtilmedi") === filterClass) && (!search || [entry.name, entry.phone, entry.id, ...Object.values(entry.answers || {}).flat()].join(" ").toLocaleLowerCase("tr").includes(search)) && (recordFilter !== "duplicates" || entry.possibleDuplicate === true) && (recordFilter !== "without-ticket" || entry.ticket?.status !== "issued") && (recordFilter !== "with-ticket" || entry.ticket?.status === "issued"));
  $("registrationFilterCount").textContent = `${matches.length} kayıt gösteriliyor${matches.length === entries.length ? "" : ` / ${entries.length} kayıt`}.`;
  $("registrationEntries").innerHTML = pendingDeletionMarkup() + (matches.slice(0, visibleLimit).map(entryMarkup).join("") || '<p class="registration-empty">Bu filtrelerle eşleşen kayıt yok.</p>');
  $("registrationMore").hidden = matches.length <= visibleLimit;
  delete $("registrationEntries").dataset.error;
  updateControls();
}
async function loadSelected({ preserveFeedback = false } = {}) {
  const id = selectedId, version = ++loadVersion;
  receiptClose();
  ticketClose();
  deleteConfirmations.clear();
  loading = !!id; entries = []; pendingTicketDeletions = []; summary = null; eventInfo = null; visibleLimit = 100;
  $("registrationEntries").innerHTML = id ? '<p class="registration-empty">Kayıtlar yükleniyor…</p>' : '<p class="registration-empty">Önce bir etkinlik oluşturun.</p>';
  delete $("registrationEntries").dataset.error;
  $("registrationFilterCount").textContent = "";
  renderStats(); renderForm();
  if (!id || !ready) { loading = false; updateControls(); return; }
  if (!preserveFeedback) feedback(hasUnsaved() ? "Bu etkinliğin kaydedilmemiş değişiklikleri korunuyor." : "Form ve kayıtlar yükleniyor…");
  try {
    const first = await api(endpoint("admin", id, { page: "1" }));
    if (version !== loadVersion || id !== selectedId) return;
    if (!Array.isArray(first.entries) || !first.form || !first.summary) throw new Error("Kayıt bilgileri doğrulanamadı. Yeniden deneyin.");
    eventInfo = first.event;
    const existingDraft = drafts.get(id);
    if (!existingDraft || JSON.stringify(stableForm(existingDraft.form)) === existingDraft.saved) {
      const form = stableForm({ ...defaultForm(id), ...first.form, eventId: id });
      drafts.set(id, { form, saved: JSON.stringify(form), savedForm: structuredClone(form) });
    }
    const allEntries = [...first.entries];
    const totalPages = Math.max(1, Number(first.totalPages) || 1);
    for (let start = 2; start <= totalPages; start += 3) {
      if (version !== loadVersion || id !== selectedId) return;
      const pages = Array.from({ length: Math.min(3, totalPages - start + 1) }, (_, offset) => start + offset);
      const responses = await Promise.all(pages.map((page) => api(endpoint("admin", id, { page: String(page) }))));
      if (version !== loadVersion || id !== selectedId) return;
      for (const response of responses) {
        if (!Array.isArray(response.entries)) throw new Error("Bazı kayıtlar yüklenemedi. Yeniden deneyin.");
        allEntries.push(...response.entries);
      }
      $("registrationEntries").textContent = `${allEntries.length} kayıt yüklendi…`;
    }
    entries = [...new Map(allEntries.map((entry) => [entry.id, entry])).values()];
    summary = first.summary;
    pendingTicketDeletions = Array.isArray(first.pendingTicketDeletions) ? first.pendingTicketDeletions : [];
    loading = false;
    renderForm(); renderStats(); renderEntries();
    if (!preserveFeedback) feedback(hasUnsaved() ? "Bu etkinliğin kaydedilmemiş değişiklikleri korunuyor." : `${first.event?.title || "Etkinlik"} için formu düzenleyebilir, kayıtları inceleyebilirsiniz.`);
    return true;
  } catch (error) {
    if (version !== loadVersion || id !== selectedId) return;
    loading = false;
    feedback(error.message, true);
    $("registrationEntries").innerHTML = '<p class="registration-empty">Kayıtlar yüklenemedi. Bağlantıyı yeniden deneyin.</p>';
    $("registrationEntries").dataset.error = "true";
    renderForm();
    return false;
  } finally {
    if (version === loadVersion && id === selectedId) updateControls();
  }
}
function populateEvents() {
  const scope = $("registrationEventScope").value;
  const listed = catalog().filter(event => scope === "all" || (scope === "archived" ? event.archived : !event.archived));
  $("registrationEvent").innerHTML = listed.length ? listed.map((event) => `<option value="${escape(event.id)}">${escape(event.title)}${event.archived ? " (arşiv)" : event.published === false ? " (taslak)" : ""}</option>`).join("") : `<option value="">${scope === "archived" ? "Arşivlenmiş etkinlik yok" : "Önce bir etkinlik oluşturun"}</option>`;
  if (!listed.some((event) => event.id === selectedId)) selectedId = listed[0]?.id || "";
  $("registrationEvent").value = selectedId;
  renderComparisonOptions();
}
async function loadSummary() {
  if (!ready) return;
  const version = ++summaryVersion;
  $("registrationComparisonFeedback").textContent = "Karşılaştırma verileri yükleniyor…";
  try {
    const response = await api(endpoint("summary", ""));
    if (version !== summaryVersion) return;
    if (!Array.isArray(response.events)) throw new Error("Karşılaştırma bilgileri doğrulanamadı.");
    comparison = response.events;
    const previousId = selectedId;
    populateEvents();
    if (previousId !== selectedId) loadSelected();
    if (!comparisonSelection.size) {
      const preferred = [selectedId, ...comparison.map((event) => event.eventId)].filter(Boolean);
      [...new Set(preferred)].slice(0, 3).forEach((id) => comparisonSelection.add(id));
    }
    renderComparisonOptions(); renderComparison();
    $("registrationComparisonFeedback").textContent = "";
  } catch (error) {
    if (version === summaryVersion) $("registrationComparisonFeedback").textContent = `${error.message} “Karşılaştırmayı yenile” ile tekrar deneyin.`;
  }
}
function renderComparisonOptions() {
  const options = new Map(events.map((event) => [event.id, { eventId: event.id, title: event.title }]));
  comparison.forEach((event) => options.set(event.eventId, event));
  $("registrationCompareEvents").innerHTML = [...options.values()].map((event) => `<label class="registration-check"><input type="checkbox" name="registrationCompareEvent" value="${escape(event.eventId)}" ${comparisonSelection.has(event.eventId) ? "checked" : ""}>${escape(event.title || "Etkinlik")}</label>`).join("") || '<p class="registration-empty">Karşılaştırılacak etkinlik yok.</p>';
}
function renderComparison() {
  const selected = comparison.filter((event) => comparisonSelection.has(event.eventId));
  if (!selected.length) { $("registrationComparison").innerHTML = '<p class="registration-empty">Karşılaştırmak için en az bir etkinlik seçin.</p>'; return; }
  const classes = [...new Set(selected.flatMap((event) => (event.byClass || []).map((group) => group.classYear || "Belirtilmedi")))].sort(classCompare);
  const rows = [["Toplam kayıt", (event) => event.total], ...classes.map((classYear) => [classYear, (event) => event.byClass?.find((group) => (group.classYear || "Belirtilmedi") === classYear)?.count || 0])];
  $("registrationComparison").innerHTML = `<div class="registration-comparison-scroll"><table class="registration-comparison-table"><caption class="registration-muted">Seçilen etkinliklerin kayıt ve sınıf dağılımı</caption><thead><tr><th scope="col">Kayıt bilgisi</th>${selected.map((event) => `<th scope="col">${escape(event.title || "Etkinlik")}${event.archived ? " (arşiv)" : ""}<button type="button" data-registration-open-event="${escape(event.eventId)}">Kayıtları aç</button></th>`).join("")}</tr></thead><tbody>${rows.map(([label, count]) => `<tr><th scope="row">${escape(label)}</th>${selected.map((event) => `<td>${Number(count(event)) || 0}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
async function fetchPrivate(path) {
  const response = await fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Dosya alınamadı. Yeniden deneyin.");
  }
  return response;
}
function receiptClose() {
  receiptVersion++;
  if ($("registrationReceiptDialog").open) $("registrationReceiptDialog").close();
  if (receiptUrl) URL.revokeObjectURL(receiptUrl);
  receiptUrl = null;
  $("registrationReceiptImage").removeAttribute("src");
  $("registrationReceiptDownload").removeAttribute("href");
}
async function showReceipt(id, opener) {
  const entry = entries.find((entry) => entry.id === id);
  if (!entry?.receipt) return;
  receiptClose();
  const eventId = selectedId, version = ++receiptVersion;
  receiptOpener = opener;
  $("registrationReceiptTitle").textContent = `${entry.name || "Katılımcı"} — dekont`;
  $("registrationReceiptMessage").textContent = "Dekont yükleniyor…";
  $("registrationReceiptImage").hidden = true;
  $("registrationReceiptDownload").hidden = true;
  $("registrationReceiptDialog").showModal();
  try {
    const response = await fetchPrivate(endpoint("receipt", eventId, { id }));
    const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "application/pdf"].includes(mime)) throw new Error("Dekontun dosya biçimi doğrulanamadı.");
    const blob = await response.blob();
    if (version !== receiptVersion || eventId !== selectedId) return;
    receiptUrl = URL.createObjectURL(blob);
    const image = mime.startsWith("image/");
    $("registrationReceiptImage").hidden = !image;
    if (image) $("registrationReceiptImage").src = receiptUrl;
    $("registrationReceiptDownload").href = receiptUrl;
    $("registrationReceiptDownload").download = entry.receipt.name || `dekont-${id}.${image ? mime === "image/png" ? "png" : "jpg" : "pdf"}`;
    $("registrationReceiptDownload").hidden = false;
    $("registrationReceiptMessage").textContent = image ? "Bu dekont yalnızca yöneticilere gösterilir." : "PDF dekontu incelemek için dosyayı indirin. Yalnızca yöneticiler erişebilir.";
  } catch (error) {
    if (version === receiptVersion) $("registrationReceiptMessage").textContent = error.message;
  }
}

function ticketClose() {
  ticketVersion++;
  if ($("registrationTicketDialog").open) $("registrationTicketDialog").close();
  releaseTicketArtwork(activeTicket?.design);
  activeTicket = null;
  $("registrationTicketPreview").replaceChildren();
  $("registrationTicketLink").value = "";
  $("registrationTicketCode").textContent = "";
  $("registrationTicketCopy").disabled = true;
  $("registrationTicketPrint").disabled = true;
}
async function showTicket(id, opener) {
  const entry = entries.find(item => item.id === id), eventId = selectedId;
  if (!entry || busyEntries.has(id) || (archived() && entry.ticket?.status !== "issued")) return;
  ticketClose();
  const version = ticketVersion;
  ticketOpener = opener;
  busyEntries.add(id);
  $("registrationTicketTitle").textContent = `${entry.name || "Katılımcı"} — katılım bileti`;
  $("registrationTicketMessage").textContent = entry.ticket?.status === "issued" ? "Bilet yükleniyor…" : "Bu kayda özel bilet hazırlanıyor…";
  $("registrationTicketDialog").showModal();
  renderEntries();
  try {
    const result = entry.ticket?.status === "issued"
      ? await api(endpoint("ticket", eventId, { id }))
      : await api(endpoint("ticket", eventId), { method: "POST", body: JSON.stringify({ id }) });
    const ticket = result.ticket;
    if (!ticket || !/^ERC-[A-F0-9]{24}$/.test(ticket.code) || typeof ticket.id !== "string" || result.event?.id !== eventId || typeof ticket.revoked !== "boolean") throw new Error("Bilet doğrulanamadı. Aynı kayıttan yeniden deneyin; yeni bir bilet oluşturulmaz.");
    if (ready && eventId === selectedId) {
      entry.ticket = { batchId: ticket.batchId, status: "issued" };
      renderStats(); renderEntries();
    }
    document.dispatchEvent(new CustomEvent("registration-ticket-issued", { detail: { eventId } }));
    if (!ready || version !== ticketVersion || eventId !== selectedId) return;
    const link = new URL("/biletler.html", location.origin);
    link.searchParams.set("ticket", ticket.code);
    $("registrationTicketLink").value = link.href;
    $("registrationTicketCode").textContent = ticket.code;
    activeTicket = { ticket, event: result.event, link: link.href, card: null, design: null };
    $("registrationTicketCopy").disabled = ticket.revoked;
    $("registrationTicketMessage").textContent = ticket.revoked ? "Bu bilet iptal edilmiş; etkinlik girişinde kullanılamaz." : ticket.claimedAt ? "Bilet katılımcının hesabına eklenmiş. Kapıda giriş yapmak ayrı bir işlemdir." : "Bilet hazır. Bağlantıyı bu katılımcıya iletebilir veya QR biletini yazdırabilirsiniz.";
    const [stored, qr] = await Promise.all([
      api(`/api/ticket-design?event_id=${encodeURIComponent(eventId)}`),
      QRCode.toDataURL(link.href, { width: 300, margin: 4 }),
    ]);
    const design = validateStoredDesign(stored.design);
    if (version !== ticketVersion || eventId !== selectedId) { releaseTicketArtwork(design); return; }
    activeTicket.design = design;
    activeTicket.card = ticketCard({ code: ticket.code, qr, eventTitle: result.event.title, ticket: { revoked: ticket.revoked, claimed_at: ticket.claimedAt }, design });
    $("registrationTicketPreview").innerHTML = activeTicket.card;
    $("registrationTicketPrint").disabled = ticket.revoked;
  } catch (error) {
    if (version === ticketVersion) $("registrationTicketMessage").textContent = error.message;
    entryFeedback.set(id, { message: error.message, error: true });
  } finally {
    busyEntries.delete(id);
    if (eventId === selectedId) renderEntries();
  }
}

onAdminEvent("events-loaded", (event) => {
  events = Array.isArray(event.detail) ? event.detail : [];
  const oldId = selectedId;
  populateEvents();
  if (ready && (oldId !== selectedId || !getDraft())) loadSelected();
});
onAdminEvent("admin-ready", () => { ready = true; loadSelected(); loadSummary(); });
document.addEventListener("registration-event", (event) => {
  if (saving) { feedback("Form kaydediliyor. Etkinliği değiştirmeden önce işlemin tamamlanmasını bekleyin.", true); return; }
  if (!event.detail?.id || !catalog().some((current) => current.id === event.detail.id)) return;
  if (catalog().find(current => current.id === event.detail.id)?.archived) $("registrationEventScope").value = "all";
  selectedId = event.detail.id;
  populateEvents();
  $("registrationEvent").value = selectedId;
  loadSelected();
});
$("registrationEvent").addEventListener("change", () => { selectedId = $("registrationEvent").value; loadSelected(); });
$("registrationEventScope").addEventListener("change", () => { populateEvents(); loadSelected(); });
$("registrationConfigForm").addEventListener("input", (event) => {
  const draft = getDraft();
  if (!draft || saving || loading) return;
  const target = event.target;
  if (target.id === "registrationDescription") draft.form.description = target.value;
  else if (target.id === "registrationMaxRegistrations") draft.form.maxRegistrations = target.value === "" ? null : Number(target.value);
  else if (target.id === "registrationEnabled") draft.form.enabled = target.checked;
  else if (target.id === "registrationReceiptEnabled") {
    draft.form.receipt.enabled = target.checked;
    if (!target.checked) { draft.form.receipt.required = false; $("registrationReceiptRequired").checked = false; }
  } else if (target.id === "registrationReceiptRequired") draft.form.receipt.required = target.checked;
  else if (target.dataset.fieldProp) {
    const field = draft.form.fields.find((field) => field.id === target.closest("[data-registration-field]")?.dataset.registrationField);
    if (!field) return;
    const prop = target.dataset.fieldProp;
    if (prop === "label") field.label = target.value;
    else if (prop === "required" && field.id !== "full_name") field.required = target.checked;
    else if (prop === "options") field.options = target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    else if (prop === "type" && !CORE_IDS.has(field.id) && Object.hasOwn(TYPE_LABELS, target.value)) {
      field.type = target.value;
      if (OPTION_TYPES.has(field.type) && !field.options?.length) field.options = ["Seçenek 1", "Seçenek 2"];
      if (!OPTION_TYPES.has(field.type)) delete field.options;
      renderFields();
    }
  } else return;
  changed();
});
$("registrationFields").addEventListener("click", (event) => {
  const button = event.target.closest("button"), draft = getDraft();
  if (!button || !draft || saving || loading) return;
  const index = draft.form.fields.findIndex((field) => field.id === button.closest("[data-registration-field]")?.dataset.registrationField);
  if (index < 0 || CORE_IDS.has(draft.form.fields[index].id)) return;
  if (button.hasAttribute("data-field-remove")) draft.form.fields.splice(index, 1);
  else if (button.dataset.fieldMove) {
    const next = index + Number(button.dataset.fieldMove);
    if (next < 3 || next >= draft.form.fields.length) return;
    [draft.form.fields[index], draft.form.fields[next]] = [draft.form.fields[next], draft.form.fields[index]];
  } else return;
  renderFields(); changed();
});
$("registrationAddField").addEventListener("click", () => {
  const draft = getDraft();
  if (!draft || saving || loading || draft.form.fields.length >= 25) return;
  draft.form.fields.push({ id: `question_${crypto.randomUUID().replaceAll("-", "")}`, type: "text", label: "Yeni soru", required: false });
  renderFields(); changed();
  $("registrationFields").lastElementChild.querySelector("input[data-field-prop=label]").focus();
});
$("registrationDiscard").addEventListener("click", () => {
  const draft = getDraft();
  if (!draft || saving || loading) return;
  draft.form = structuredClone(draft.savedForm);
  renderForm(); feedback("Bu etkinliğin son kaydedilen formuna dönüldü.");
});
$("registrationConfigForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || loading || archived() || !getDraft()) return;
  const id = selectedId, draft = getDraft(), form = stableForm(draft.form);
  if (form.maxRegistrations != null && (!Number.isInteger(form.maxRegistrations) || form.maxRegistrations < 1 || form.maxRegistrations > 10000)) { feedback("Kayıt üst sınırı 1 ile 10000 arasında tam sayı olmalı. Sınırsız kayıt için alanı boş bırakın.", true); return; }
  for (const field of form.fields) {
    if (!field.label.trim()) { feedback("Her soruya bir başlık yazın.", true); return; }
    if (OPTION_TYPES.has(field.type) && (!field.options.length || field.options.length > 40 || field.options.some((option) => option.length > 160) || new Set(field.options).size !== field.options.length)) { feedback("Seçenekli sorularda en fazla 40 farklı seçenek kullanın; her seçenek en fazla 160 karakter olmalı.", true); return; }
  }
  saving = true; updateControls(); feedback("Kayıt formu kaydediliyor…");
  try {
    const response = await api(endpoint("form", id), { method: "POST", body: JSON.stringify(form) });
    if (!ready) return;
    if (!response.ok || !response.form) throw new Error("Formun kaydedildiği doğrulanamadı. Değişiklikleriniz korunuyor; yeniden deneyin.");
    const stored = stableForm({ ...response.form, eventId: id });
    drafts.set(id, { form: stored, saved: JSON.stringify(stored), savedForm: structuredClone(stored) });
    const current = events.find((event) => event.id === id);
    if (current) { current.registrationMode = "native"; current.registrationEnabled = stored.enabled && !isAtLimit(); }
    document.dispatchEvent(new CustomEvent("registration-config-saved", { detail: { eventId: id, enabled: stored.enabled } }));
    renderForm(); renderStats(); feedback(stored.enabled ? isAtLimit() ? "Form kaydedildi. Kontenjan dolduğu için yeni kayıt alımı otomatik kapalı." : "Form kaydedildi. Yayımlanmış güncel etkinliğin kayıt bağlantısından erişilebilir." : "Form kaydedildi; yeni kayıt alımı kapalı. Önceki kayıtlar ve dekontlar korunuyor.");
    loadSummary();
  } catch (error) { feedback(error.message, true); }
  finally { saving = false; updateControls(); }
});
for (const id of ["registrationSearch", "registrationClassFilter", "registrationRecordFilter"]) $(id).addEventListener(id === "registrationSearch" ? "input" : "change", () => { visibleLimit = 100; renderEntries(); });
$("registrationMore").addEventListener("click", () => { visibleLimit += 100; renderEntries(); });
$("registrationReload").addEventListener("click", () => loadSelected());
$("registrationRetry").addEventListener("click", () => loadSelected());
$("registrationCompareEvents").addEventListener("change", (event) => {
  if (event.target.name !== "registrationCompareEvent") return;
  if (event.target.checked) comparisonSelection.add(event.target.value); else comparisonSelection.delete(event.target.value);
  renderComparison();
});
$("registrationCompareReload").addEventListener("click", loadSummary);
$("registrationComparison").addEventListener("click", event => {
  const button = event.target.closest("[data-registration-open-event]");
  if (!button) return;
  document.dispatchEvent(new CustomEvent("registration-event", { detail: { id: button.dataset.registrationOpenEvent } }));
});
$("registrationEntries").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.registrationReceipt) { showReceipt(button.dataset.registrationReceipt, button); return; }
  if (button.dataset.registrationTicket) { showTicket(button.dataset.registrationTicket, button); return; }
  if (button.dataset.registrationCleanup) {
    const id = button.dataset.registrationCleanup, eventId = selectedId;
    if (busyEntries.has(id)) return;
    busyEntries.add(id); entryFeedback.set(id, { message: "Bilet iptali doğrulanıyor…" }); renderEntries();
    try {
      const response = await api(endpoint("delete", eventId), { method: "POST", body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("Bilet iptali doğrulanamadı. Aynı işlemi yeniden deneyin.");
      if (eventId === selectedId) pendingTicketDeletions = pendingTicketDeletions.filter(item => item.id !== id);
      entryFeedback.delete(id);
      feedback("Silinen kaydın QR bileti iptal edildi.");
    } catch (error) { entryFeedback.set(id, { message: error.message, error: true }); }
    finally { busyEntries.delete(id); if (eventId === selectedId) renderEntries(); }
    return;
  }
  const id = button.dataset.registrationDelete || button.dataset.registrationDeleteConfirm || button.dataset.registrationDeleteCancel, eventId = selectedId;
  if (!id || busyEntries.has(id) || !entries.some((entry) => entry.id === id)) return;
  if (button.dataset.registrationDelete) {
    deleteConfirmations.add(id);
    renderEntries();
    [...$("registrationEntries").querySelectorAll("[data-registration-delete-confirm]")].find((button) => button.dataset.registrationDeleteConfirm === id)?.focus();
    return;
  }
  if (button.dataset.registrationDeleteCancel) {
    deleteConfirmations.delete(id);
    renderEntries();
    [...$("registrationEntries").querySelectorAll("[data-registration-delete]")].find((button) => button.dataset.registrationDelete === id)?.focus();
    return;
  }
  if (!button.dataset.registrationDeleteConfirm || !deleteConfirmations.has(id)) return;
  busyEntries.add(id);
  entryFeedback.set(id, { message: "Kayıt siliniyor…", error: false });
  renderEntries();
  try {
    const response = await api(endpoint("delete", eventId), { method: "POST", body: JSON.stringify({ id }) });
    if (!response.ok) throw new Error("Kaydın silindiği doğrulanamadı. Listeyi yenileyip yeniden deneyin.");
    entryFeedback.delete(id);
    deleteConfirmations.delete(id);
    if (eventId === selectedId) {
      entries = entries.filter((entry) => entry.id !== id);
      feedback("Kayıt silindi. Kayıt listesi ve karşılaştırma güncelleniyor…");
    }
    document.dispatchEvent(new CustomEvent("registration-config-saved", { detail: { eventId, enabled: drafts.get(eventId)?.savedForm.enabled } }));
    const [refresh] = await Promise.all([eventId === selectedId ? loadSelected({ preserveFeedback: true }) : Promise.resolve(), loadSummary()]);
    if (eventId === selectedId && refresh === true) feedback("Kayıt ve dekontu silindi. Kayıt sayıları güncellendi.");
    else if (eventId === selectedId && refresh === false) feedback("Kayıt silindi; güncel liste alınamadı. Kayıtları yeniden yükleyin.", true);
  } catch (error) {
    entryFeedback.set(id, { message: error.message, error: true });
    if (eventId === selectedId) {
      feedback(error.message, true);
      await loadSelected({ preserveFeedback: true });
      if (eventId === selectedId && entries.some(entry => entry.id === id)) deleteConfirmations.add(id);
    }
  } finally {
    busyEntries.delete(id);
    if (eventId === selectedId) renderEntries();
  }
});
$("registrationExport").addEventListener("click", async () => {
  const button = $("registrationExport"), id = selectedId, version = loadVersion;
  if (!id) return;
  button.disabled = true; feedback("Kayıt listesi hazırlanıyor…");
  try {
    const response = await fetchPrivate(endpoint("export", id));
    const blob = await response.blob();
    if (!ready || id !== selectedId || version !== loadVersion) return;
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/i)?.[1];
    link.href = url; link.download = filename ? filename.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160) : `ERCUPSA-kayitlar-${id}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (id === selectedId) feedback("Tüm kayıtları içeren CSV dosyası indirildi.");
  } catch (error) { if (id === selectedId) feedback(error.message, true); }
  finally { updateControls(); }
});
$("registrationReceiptClose").addEventListener("click", receiptClose);
$("registrationReceiptDialog").addEventListener("cancel", (event) => { event.preventDefault(); receiptClose(); });
$("registrationReceiptDialog").addEventListener("close", () => {
  // An older queued close event must not invalidate a newly opened receipt.
  if ($("registrationReceiptDialog").open) return;
  if (receiptUrl) URL.revokeObjectURL(receiptUrl);
  receiptUrl = null;
  receiptVersion++;
  if (receiptOpener?.isConnected) receiptOpener.focus();
  receiptOpener = null;
});
$("registrationTicketClose").addEventListener("click", ticketClose);
$("registrationTicketDialog").addEventListener("cancel", event => { event.preventDefault(); ticketClose(); });
$("registrationTicketDialog").addEventListener("close", () => {
  if ($("registrationTicketDialog").open) return;
  if (activeTicket) ticketClose();
  if (ticketOpener?.isConnected) ticketOpener.focus();
  else $("registrationEvent").focus();
  ticketOpener = null;
});
$("registrationTicketCopy").addEventListener("click", async () => {
  const current = activeTicket;
  if (!current || current.ticket.revoked) return;
  try {
    await navigator.clipboard.writeText(current.link);
    if (activeTicket === current) $("registrationTicketMessage").textContent = "Bilet bağlantısı kopyalandı. Yalnızca bu katılımcıya iletin.";
  } catch {
    if (activeTicket !== current) return;
    $("registrationTicketLink").focus(); $("registrationTicketLink").select();
    $("registrationTicketMessage").textContent = "Bağlantıyı yukarıdaki alandan seçip elle kopyalayabilirsiniz.";
  }
});
$("registrationTicketPrint").addEventListener("click", async () => {
  const current = activeTicket;
  if (!current?.card || current.ticket.revoked || ticketPrintAbort) return;
  const controller = new AbortController();
  ticketPrintAbort = controller;
  const printing = printTickets([current.card], current.event.title, { signal: controller.signal });
  ticketClose();
  try { await printing; }
  catch (error) { if (!controller.signal.aborted) feedback(error.message || "Bilet yazdırılamadı. Bileti yeniden açıp deneyin.", true); }
  finally { if (ticketPrintAbort === controller) ticketPrintAbort = null; }
});
document.addEventListener("admin-logout", () => {
  ready = false; loadVersion++; summaryVersion++;
  ticketPrintAbort?.abort(); ticketPrintAbort = null;
  receiptClose(); ticketClose();
  drafts.clear(); busyEntries.clear(); entryFeedback.clear(); deleteConfirmations.clear(); comparisonSelection.clear();
  entries = []; events = []; selectedId = ""; comparison = []; pendingTicketDeletions = []; eventInfo = null; summary = null;
  ticketOpener = null; receiptOpener = null;
  $("registrationEntries").replaceChildren();
  $("registrationComparison").replaceChildren();
  renderStats(); renderForm();
});
window.addEventListener("beforeunload", (event) => {
  if (![...drafts.values()].some((draft) => JSON.stringify(stableForm(draft.form)) !== draft.saved)) return;
  event.preventDefault(); event.returnValue = "";
});
updateControls();
