import QRCode from "qrcode";
import "./admin-registrations.js";
import "./admin-raffles.js";
import "./admin-gate.js";
import "./admin-instagram.js";
import { $, escape, api, status, onAdminEvent } from "./common.js";
import {
  ticketCard,
  ticketSheets,
  printTickets,
  TICKETS_PER_PAGE,
} from "./ticket-print.js";
import { readTicketDesign, validateStoredDesign, releaseTicketArtwork } from "./ticket-template.js";
let data = { batches: [] };
let events = [], design = null, designEventId = "", designState = "idle";
let ready = false, authGeneration = 0, catalogLoadVersion = 0;
let designBusy = false, batchBusy = false, fileReading = false, candidate = null, candidateFile = null;
let designLoadVersion = 0, fileReadVersion = 0, batchLoadVersion = 0, cardsVersion = 0;
let designPromise = null, openedBatch = null;
const tabs = ["events", "registrations", "tickets", "raffles", "attendance", "instagram"];
function tab(name) {
  if (!tabs.includes(name)) return;
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
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
onAdminEvent("events-loaded", (e) => {
  events = e.detail;
  if (ready) updateEvents();
});
function updateEvents() {
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
  $("ticketEvent").disabled = !ready || designBusy;
  $("ticketDesignFile").disabled = !designReady || designBusy;
  $("ticketDesignSave").disabled = !designReady || !candidate || designBusy || fileReading;
  $("ticketDesignReset").disabled = !ready || !$("ticketEvent").value || (designState !== "error" && (!designReady || !design)) || designBusy || fileReading;
  $("ticketDesignCancel").hidden = !candidate;
  $("ticketDesignCancel").disabled = designBusy;
  $("ticketDesignRetry").hidden = designState !== "error";
  $("ticketDesignRetry").disabled = designBusy;
  $("createBatch").disabled = !designReady || designBusy || batchBusy || !!candidate || fileReading;
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
    if (version !== fileReadVersion || eventId !== $("ticketEvent").value) return;
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
  if (!ready || designBusy || (designState !== "ready" && !(method === "DELETE" && designState === "error"))) return;
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
  ready = true;
  updateEvents();
  load();
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
  if (!b || !ready) return;
  const generation = authGeneration;
  try {
    if (b.dataset.batch) await showBatch(b.dataset.batch);
    if (b.dataset.revoke && confirm("Bu bilet iptal edilsin mi?")) {
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
$("batchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  if (!ready || designState !== "ready" || designBusy || batchBusy || candidate || fileReading) {
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
    return {
      card: ticketCard({ code, qr, eventTitle: d.event_title, ticket, design: artwork }),
      control: `<div class="ticket-controls no-print"><span>${ticket?.revoked ? "İptal" : claimState} · ${entryState}</span>${ticket && !ticket.revoked && !ticket.claimed_at ? `<button class="text-red-700" data-revoke="${escape(ticket.id)}">İptal et</button>` : ""}</div>`,
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
  tab("events");
});
tab("events");
updateTicketControls();
