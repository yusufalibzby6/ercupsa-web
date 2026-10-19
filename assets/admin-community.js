import QRCode from "qrcode";
import "./admin-registrations.js";
import "./admin-raffles.js";
import "./admin-gate.js";
import "./admin-instagram.js";
import "./admin-accounts.js";
import "./admin-users.js";
import "./admin-team.js";
import { $, escape, api, status, onAdminEvent, canAdmin, isOwner } from "./common.js";
import {
  ticketCard,
  ticketSheets,
  printTickets,
  TICKETS_PER_PAGE,
} from "./ticket-print.js";
import { readTicketDesign, validateStoredDesign, releaseTicketArtwork } from "./ticket-template.js";
import { ticketPublicUrl, createTicketFiles, downloadTicketFile } from "./ticket-export.js";
let data = { batches: [] };
let events = [], design = null, designEventId = "", designState = "idle";
let ready = false, authGeneration = 0, catalogLoadVersion = 0;
let designBusy = false, batchBusy = false, fileReading = false, candidate = null, candidateFile = null;
let designLoadVersion = 0, fileReadVersion = 0, batchLoadVersion = 0, cardsVersion = 0;
let designPromise = null, openedBatch = null;
const tabs = ["events", "registrations", "tickets", "raffles", "attendance", "accounts", "instagram", "team", "adminUsers"];
let currentTab = "";
const tabAllowed = name => ["adminUsers", "team"].includes(name) ? isOwner() : canAdmin(`${name}.view`);
function tab(name) {
  if (!tabs.includes(name) || !tabAllowed(name)) return;
  currentTab = name;
  for (const t of tabs) {
    const section = $(t + "Tab");
    if (section) section.hidden = t !== name;
  }
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (active) {
      if ($("adminSectionTitle")) $("adminSectionTitle").textContent = button.dataset.sectionTitle || button.textContent.trim();
      if ($("adminSectionDescription")) $("adminSectionDescription").textContent = button.dataset.sectionDescription || "";
    }
  }
  document.dispatchEvent(new CustomEvent("admin-tab", { detail: name }));
}
function updateNavigation() {
  for (const button of document.querySelectorAll("[data-tab]")) button.hidden = !tabAllowed(button.dataset.tab);
  if (currentTab && tabAllowed(currentTab)) return;
  currentTab = "";
  for (const name of tabs) { const section = $(name + "Tab"); if (section) section.hidden = true; }
  const allowed = tabs.find(tabAllowed);
  if (allowed) tab(allowed);
  else { $("adminSectionTitle").textContent = "Erişim bekleniyor"; $("adminSectionDescription").textContent = "Bu hesap için henüz bölüm erişimi tanımlanmamış. Baş admin erişimlerinizi düzenleyebilir."; }
}
onAdminEvent("admin-session", updateNavigation);
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
onAdminEvent("events-loaded", (e) => {
  events = e.detail;
  if (ready && canAdmin("tickets.view")) updateEvents();
});
function updateEvents() {
  if (!ready || !canAdmin("tickets.view")) return;
  const previous = $("ticketEvent").value;
  $("ticketEvent").innerHTML = events
    .map((v) => `<option value="${escape(v.id)}">${escape(v.title)}</option>`)
    .join("");
  if (events.some((v) => v.id === previous)) $("ticketEvent").value = previous;
  if (!designBusy && (designEventId !== $("ticketEvent").value || designState === "idle")) {
    changeTicketEvent();
  }
}
document.addEventListener("ticket-event", (e) => {
  if (!ready || !canAdmin("tickets.view")) return;
  tab("tickets");
  if (designBusy) {
    status("Tasarım işlemi tamamlandıktan sonra etkinliği değiştirebilirsiniz.", true);
    return;
  }
  $("ticketEvent").value = e.detail.id;
  changeTicketEvent();
});
document.addEventListener("registration-event", () => tab("registrations"));
$("ticketEvent").addEventListener("change", changeTicketEvent);
function designStatus(message, error = false) {
  $("ticketDesignStatus").textContent = message;
  $("ticketDesignStatus").dataset.error = String(error);
}
function updateTicketControls() {
  const designReady = ready && designState === "ready" && designEventId === $("ticketEvent").value;
  const manage = ready && canAdmin("tickets.manage");
  $("ticketEvent").disabled = !ready || designBusy;
  $("ticketDesignFile").disabled = !manage || !designReady || designBusy;
  $("ticketDesignSave").disabled = !manage || !designReady || !candidate || designBusy || fileReading;
  $("ticketDesignReset").disabled = !manage || !$("ticketEvent").value || (designState !== "error" && (!designReady || !design)) || designBusy || fileReading;
  $("ticketDesignForm").hidden = !manage;
  $("ticketCount").closest("label").hidden = !manage;
  $("createBatch").hidden = !manage;
  $("ticketDesignCancel").hidden = !candidate;
  $("ticketDesignCancel").disabled = designBusy;
  $("ticketDesignRetry").hidden = designState !== "error";
  $("ticketDesignRetry").disabled = designBusy;
  $("createBatch").disabled = !manage || !designReady || designBusy || batchBusy || !!candidate || fileReading;
  const print = $("printTickets");
  if (print) print.disabled = !designReady || designBusy || !!candidate || fileReading;
}
function renderDesignPreview() {
  const current = events.find((e) => e.id === $("ticketEvent").value);
  const title = current?.title || openedBatch?.event_title || "Etkinlik";
  $("ticketDesignEvent").textContent = current ? `${title} için tasarım` : "Önce bir etkinlik seçin.";
  $("ticketDesignPreview").innerHTML = designState === "ready"
    ? ticketCard({ code: "ERC-ÖNİZLEME", qr: "assets/ticket-qr-placeholder.svg", eventTitle: title, design: candidate || design, preview: true })
    : "";
}
function clearCandidate() {
  fileReadVersion++;
  fileReading = false;
  releaseTicketArtwork(candidate);
  candidate = null;
  candidateFile = null;
  $("ticketDesignFile").value = "";
}
function changeTicketEvent() {
  batchLoadVersion++;
  openedBatch = null;
  $("ticketOutput").innerHTML = "";
  delete $("ticketOutput").dataset.batch;
  clearCandidate();
  loadSelectedDesign().catch(() => {});
}
function loadSelectedDesign() {
  if (!ready) return Promise.resolve(null);
  const eventId = $("ticketEvent").value;
  const version = ++designLoadVersion;
  cardsVersion++;
  designEventId = eventId;
  designState = eventId ? "loading" : "idle";
  $("ticketOutput").innerHTML = "";
  releaseTicketArtwork(design);
  design = null;
  designStatus(eventId ? "Kaydedilmiş tasarım yükleniyor…" : "Bilet tasarlamak için önce bir etkinlik oluşturun.");
  renderDesignPreview();
  updateTicketControls();
  if (!eventId) return Promise.resolve(null);
  designPromise = (async () => {
    try {
      const response = await api(`/api/ticket-design?event_id=${encodeURIComponent(eventId)}`);
      if (version !== designLoadVersion || eventId !== $("ticketEvent").value) return null;
      if (!Object.hasOwn(response, "design")) throw new Error("Bilet tasarımı sunucudan doğrulanamadı.");
      design = validateStoredDesign(response.design);
      designState = "ready";
      designStatus(candidate ? "Seçilen dosya henüz kaydedilmedi. Biletlerde kullanmak için tasarımı yükleyin." : design ? "Bu etkinliğin kaydedilmiş tasarımı gösteriliyor." : "Bu etkinlik standart ERCUPSA bilet tasarımını kullanıyor.");
      renderDesignPreview();
      updateTicketControls();
      if (openedBatch?.event_id === eventId) await renderOpenedBatch();
      return design;
    } catch (error) {
      if (version === designLoadVersion && eventId === $("ticketEvent").value) {
        designState = "error";
        designStatus(`${error.message} Tasarım doğrulanmadan bilet basılamaz.`, true);
        $("ticketOutput").innerHTML = "";
        renderDesignPreview();
        updateTicketControls();
      }
      throw error;
    }
  })();
  return designPromise;
}
$("ticketDesignRetry").onclick = () => loadSelectedDesign().catch(() => {});
$("ticketDesignCancel").onclick = () => {
  clearCandidate();
  designStatus(design ? "Kaydedilmiş tasarıma dönüldü." : "Standart tasarım gösteriliyor.");
  renderDesignPreview();
  updateTicketControls();
};
$("ticketDesignFile").addEventListener("change", async () => {
  if (!ready || !canAdmin("tickets.manage")) return;
  const file = $("ticketDesignFile").files[0];
  const eventId = $("ticketEvent").value;
  const version = ++fileReadVersion;
  releaseTicketArtwork(candidate);
  candidate = null;
  candidateFile = null;
  fileReading = !!file;
  renderDesignPreview();
  updateTicketControls();
  if (!file) {
    renderDesignPreview();
    return;
  }
  designStatus("Görselin biçimi ve boyutları kontrol ediliyor…");
  try {
    const result = await readTicketDesign(file);
    if (!ready || !canAdmin("tickets.manage") || version !== fileReadVersion || eventId !== $("ticketEvent").value) { releaseTicketArtwork(result); return; }
    candidate = result;
    candidateFile = file;
    designStatus(`${file.name}: önizleme hazır. Biletlerde kullanmak için “Tasarımı yükle”ye basın.`);
  } catch (error) {
    if (version !== fileReadVersion || eventId !== $("ticketEvent").value) return;
    $("ticketDesignFile").value = "";
    designStatus(error.message, true);
  } finally {
    if (version === fileReadVersion) {
      fileReading = false;
      renderDesignPreview();
      updateTicketControls();
    }
  }
});
async function saveDesign(method) {
  if (!ready || !canAdmin("tickets.manage") || designBusy || (designState !== "ready" && !(method === "DELETE" && designState === "error"))) return;
  const generation = authGeneration;
  const eventId = $("ticketEvent").value;
  if (method === "POST" && !candidateFile) return;
  designBusy = true;
  cardsVersion++;
  updateTicketControls();
  designStatus(method === "POST" ? "Tasarım kaydediliyor…" : "Standart tasarıma dönülüyor…");
  try {
    await api(`/api/ticket-design?event_id=${encodeURIComponent(eventId)}`, {
      method,
      ...(method === "POST" ? { headers: { "Content-Type": candidateFile.type }, body: candidateFile } : {}),
    });
    if (!ready || generation !== authGeneration) return;
    clearCandidate();
    await loadSelectedDesign();
    if (!ready || generation !== authGeneration) return;
    designStatus(method === "POST" ? "Tasarım kaydedildi. Görseliniz biletin tamamını kaplar; üzerine her bilete farklı QR kodu eklenir." : "Standart ERCUPSA tasarımına dönüldü.");
  } catch (error) {
    if (!ready || generation !== authGeneration) return;
    // A timeout may happen after storage succeeded. Do not print an older cached image.
    designState = "error";
    designStatus(`${error.message} Kaydedilmiş tasarımı yeniden kontrol etmek için bağlantıyı yeniden deneyin.`, true);
    $("ticketOutput").innerHTML = "";
    renderDesignPreview();
  } finally {
    if (generation === authGeneration) {
      designBusy = false;
      updateTicketControls();
    }
  }
}
$("ticketDesignForm").addEventListener("submit", (e) => {
  e.preventDefault();
  saveDesign("POST");
});
$("ticketDesignReset").onclick = () => {
  if (confirm("Bu etkinliğin özel bilet tasarımı kaldırılıp standart tasarıma dönülsün mü?")) saveDesign("DELETE");
};
async function load() {
  if (!ready) return;
  const generation = authGeneration;
  const version = ++catalogLoadVersion;
  try {
    const result = await api("/api/community?action=batches");
    if (!ready || generation !== authGeneration || version !== catalogLoadVersion) return;
    data = { batches: Array.isArray(result.batches) ? result.batches : [] };
    render();
  } catch (e) {
    if (ready && generation === authGeneration && version === catalogLoadVersion) status(e.message, true);
  }
}
onAdminEvent("admin-ready", () => {
  ready = canAdmin("tickets.view");
  updateNavigation();
  if (ready) { updateEvents(); load(); }
  updateTicketControls();
});
function render() {
  $("batchList").innerHTML = data.batches
    .map(
      (b) =>
        `<button data-batch="${escape(b.id)}" class="card rounded-xl p-4 text-left">${escape(b.event_title)} · ${new Date(b.created_at).toLocaleString("tr-TR")} · Biletleri aç</button>`,
    )
    .join("");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || !ready || !canAdmin("tickets.view")) return;
  const generation = authGeneration;
  try {
    if (b.dataset.batch) await showBatch(b.dataset.batch);
    if (b.dataset.digitalCode) await exportBatchTicket(b);
    if (b.dataset.revoke && canAdmin("tickets.manage") && confirm("Bu bilet iptal edilsin mi?")) {
      await api("/api/community?action=revoke", {
        method: "POST",
        body: JSON.stringify({ id: b.dataset.revoke }),
      });
      if (!ready || generation !== authGeneration) return;
      await showBatch($("ticketOutput").dataset.batch);
    }
  } catch (e) {
    if (ready && generation === authGeneration) status(e.message, true);
  }
});
async function exportBatchTicket(button) {
  const batch = openedBatch;
  const generation = authGeneration;
  const version = cardsVersion;
  const eventId = $("ticketEvent").value;
  const code = button.dataset.digitalCode;
  const action = button.dataset.digitalAction;
  const sameContext = () => ready && canAdmin("tickets.view") && generation === authGeneration && version === cardsVersion && openedBatch === batch && batch?.event_id === eventId && eventId === $("ticketEvent").value;
  const current = () => sameContext() && designState === "ready" && !designBusy && !candidate && !fileReading;
  if (button.disabled || !current() || !batch.codes.includes(code) || !["copy", "image", "pdf"].includes(action)) return;
  const controls = button.closest(".ticket-controls");
  const buttons = [...controls.querySelectorAll("button[data-digital-code]")];
  const result = controls.querySelector("[data-digital-status]");
  buttons.forEach(item => { item.disabled = true; });
  delete result.dataset.error;
  result.textContent = action === "copy" ? "Bağlantı kopyalanıyor…" : "Bilet dosyası hazırlanıyor…";
  try {
    const digest = await hash(code);
    const ticket = batch.tickets.find(item => item.code_hash === digest);
    if (!current()) return;
    if (!ticket || ticket.revoked) throw new Error("Bu biletin durumu doğrulanamadı veya bilet iptal edilmiş.");
    if (action === "copy") {
      if (!navigator.clipboard?.writeText) throw new Error("Bu tarayıcı bağlantıyı kopyalayamıyor. “Bileti aç” bağlantısını paylaşabilirsiniz.");
      await navigator.clipboard.writeText(ticketPublicUrl(code));
    } else {
      const files = await createTicketFiles({ code, eventTitle: batch.event_title, design, event: events.find(item => item.id === eventId) });
      if (!current()) return;
      downloadTicketFile(action === "pdf" ? files.pdf : files.image);
    }
    if (current()) result.textContent = action === "copy" ? "Kişiye özel bilet bağlantısı kopyalandı." : "Bilet indirildi.";
  } catch (error) {
    if (current()) {
      result.textContent = error.message || "Bilet hazırlanamadı. Lütfen tekrar deneyin.";
      result.dataset.error = "true";
    }
  } finally {
    if (sameContext()) {
      buttons.forEach(item => { item.disabled = false; });
      if (!current()) result.textContent = "Tasarım değişti. Bileti yeniden hazırlayabilirsiniz.";
    }
  }
}
$("batchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  if (!ready || !canAdmin("tickets.manage") || designState !== "ready" || designBusy || batchBusy || candidate || fileReading) {
    status("Biletleri oluşturmadan önce etkinliğin tasarımını kaydedin veya bağlantıyı yeniden deneyin.", true);
    return;
  }
  batchBusy = true;
  b.disabled = true;
  const eventId = $("ticketEvent").value;
  const selectionVersion = batchLoadVersion;
  const generation = authGeneration;
  try {
    const d = await api("/api/community?action=batch", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        count: Number($("ticketCount").value),
      }),
    });
    if (!ready || generation !== authGeneration) return;
    await load();
    if (!ready || generation !== authGeneration) return;
    if (selectionVersion === batchLoadVersion && eventId === $("ticketEvent").value) await showBatch(d.id);
    status(`${d.codes.length} bilet oluşturuldu.`);
  } catch (e) {
    if (ready && generation === authGeneration) status(e.message, true);
  } finally {
    if (generation === authGeneration) {
      batchBusy = false;
      updateTicketControls();
    }
  }
});
async function hash(code) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function showBatch(id) {
  if (!ready) return;
  if (designBusy || fileReading || candidate) {
    throw new Error("Önce seçtiğiniz tasarımı kaydedin veya seçimi iptal edin.");
  }
  const version = ++batchLoadVersion;
  cardsVersion++;
  $("ticketOutput").innerHTML = "<p>Biletler ve etkinliğin tasarımı hazırlanıyor…</p>";
  const d = await api("/api/community?action=batch&id=" + encodeURIComponent(id));
  if (!ready || version !== batchLoadVersion) return;
  let eventId = d.event_id || data.batches.find((b) => b.id === id)?.event_id;
  if (!eventId) {
    const matching = events.filter((e) => e.title === d.event_title);
    if (matching.length === 1) eventId = matching[0].id;
  }
  if (!eventId) {
    $("ticketOutput").innerHTML = "";
    throw new Error("Bu bilet grubunun etkinliği belirlenemedi. Yanlış tasarımla çıktı almamak için etkinlik bilgisinin düzeltilmesi gerekiyor.");
  }
  if (!Array.from($("ticketEvent").options).some((o) => o.value === eventId)) {
    const option = new Option(`${d.event_title} (arşiv)`, eventId);
    $("ticketEvent").add(option);
  }
  $("ticketEvent").value = eventId;
  clearCandidate();
  if (designEventId !== eventId || designState !== "ready") {
    if (designEventId === eventId && designState === "loading") await designPromise;
    else await loadSelectedDesign();
  }
  if (!ready || version !== batchLoadVersion || $("ticketEvent").value !== eventId) return;
  if (designState !== "ready") throw new Error("Bilet tasarımı doğrulanamadı. Lütfen yeniden deneyin.");
  openedBatch = { ...d, id, event_id: eventId };
  await renderOpenedBatch();
}
async function renderOpenedBatch() {
  const d = openedBatch;
  if (!ready || !d || designState !== "ready" || d.event_id !== designEventId || d.event_id !== $("ticketEvent").value) return;
  const version = ++cardsVersion;
  const artwork = design;
  const rows = await Promise.all(d.codes.map(async (code) => {
    const digest = await hash(code);
    const ticket = d.tickets.find((t) => t.code_hash === digest);
    const qr = await QRCode.toDataURL(
      location.origin + "/biletler.html?ticket=" + encodeURIComponent(code),
      { width: 320, margin: 4, errorCorrectionLevel: "M" },
    );
    const claimState = !ticket ? "Bilet durumu doğrulanamadı" : ticket.claimed_at ? "Hesaba eklendi" : "Henüz hesaba eklenmedi";
    const entryState = !ticket || d.checkins_available !== true
      ? "Giriş durumu doğrulanamadı"
      : ticket.entered_at ? "Kapıda giriş yaptı" : "Henüz giriş yapmadı";
    const digitalControls = ticket && !ticket.revoked
      ? `<div class="flex flex-wrap gap-2 mt-2"><a class="border rounded-lg px-3 py-2" href="${escape(ticketPublicUrl(code))}" target="_blank" rel="noopener noreferrer">Bileti aç</a><button class="border rounded-lg px-3 py-2" data-digital-code="${escape(code)}" data-digital-action="copy">Bağlantıyı kopyala</button><button class="border rounded-lg px-3 py-2" data-digital-code="${escape(code)}" data-digital-action="image">Fotoğraf indir</button><button class="border rounded-lg px-3 py-2" data-digital-code="${escape(code)}" data-digital-action="pdf">PDF indir (A4)</button></div><p class="text-sm mt-2" data-digital-status role="status" aria-live="polite"></p>`
      : "";
    return {
      card: ticketCard({ code, qr, eventTitle: d.event_title, ticket, design: artwork }),
      control: `<div class="ticket-controls no-print flex-col items-start"><span>${ticket?.revoked ? "İptal" : claimState} · ${entryState}</span>${digitalControls}${canAdmin("tickets.manage") && ticket && !ticket.revoked && !ticket.claimed_at ? `<button class="text-red-700" data-revoke="${escape(ticket.id)}">İptal et</button>` : ""}</div>`,
    };
  }));
  if (!ready || version !== cardsVersion || openedBatch !== d || d.event_id !== $("ticketEvent").value) return;
  const cards = rows.map((r) => r.card);
  $("ticketOutput").dataset.batch = d.id;
  $("ticketOutput").innerHTML =
    `<div class="no-print mb-4"><h3 class="font-bold">${escape(d.event_title)}</h3><button id="printTickets" class="btn-primary rounded-xl p-3 font-bold">Çıktı oluştur</button><p class="mt-3 text-sm text-gray-500">${cards.length} bilet · ${Math.ceil(cards.length / TICKETS_PER_PAGE)} A4 sayfa. Her sayfada en fazla 10 bilet; kesim çizgileri hazır. ${artwork ? "Etkinliğe özel tasarım kullanılıyor." : "Standart tasarım kullanılıyor."}</p><p class="mt-2 text-sm text-gray-500">Hesaba eklenme ve kapıdan giriş ayrı durumlardır. Kapı durumu yalnızca görevlinin giriş kaydını gösterir.${d.checkins_available === true ? "" : " Giriş kayıtları şu anda doğrulanamadı; bilet grubunu yeniden açarak tekrar deneyin."}</p></div>` +
    ticketSheets(cards, rows.map((r) => r.control));
  updateTicketControls();
  $("printTickets").onclick = async () => {
    if (!ready || version !== cardsVersion || designBusy || candidate || fileReading || designState !== "ready" || d.event_id !== $("ticketEvent").value) return;
    const button = $("printTickets");
    button.disabled = true;
    try {
      await printTickets(cards, d.event_title);
    } catch {
      status("Çıktı hazırlanamadı. Lütfen tekrar deneyin.", true);
    } finally {
      updateTicketControls();
    }
  };
}
document.addEventListener("admin-logout", () => {
  ready = false;
  authGeneration++;
  catalogLoadVersion++;
  designLoadVersion++;
  batchLoadVersion++;
  cardsVersion++;
  data = { batches: [] };
  events = [];
  openedBatch = null;
  designBusy = false;
  batchBusy = false;
  clearCandidate();
  releaseTicketArtwork(design);
  design = null;
  designEventId = "";
  designState = "idle";
  designPromise = null;
  $("ticketEvent").innerHTML = "";
  $("batchList").innerHTML = "";
  $("ticketOutput").innerHTML = "";
  delete $("ticketOutput").dataset.batch;
  renderDesignPreview();
  designStatus("");
  updateTicketControls();
  currentTab = "";
  updateNavigation();
});
updateNavigation();
updateTicketControls();
