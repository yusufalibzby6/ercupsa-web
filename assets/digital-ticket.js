import { createTicketFiles, downloadTicketFile, renderTicketImage, ticketCanvasBlob, ticketClaimUrl, ticketDateLabel, validDigitalTicketCode } from "./ticket-export.js";

const $ = id => document.getElementById(id);
let requestVersion = 0;
let controller;
let imageUrl;
let currentTicket;
let filesPromise;

function readCode() {
  const params = new URLSearchParams(location.search);
  let hash = "";
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch {}
  const code = hash || params.get("code") || params.get("ticket") || "";
  // Compatibility with query links without carrying the bearer code to other
  // page requests. New personal links always keep it in the URL fragment.
  if (location.search) history.replaceState(null, "", location.pathname + (code ? "#" + encodeURIComponent(code) : ""));
  return code;
}

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  $("ticketImage").removeAttribute("src");
}

function showError(message, retry) {
  $("ticketLoading").hidden = true;
  $("ticketContent").hidden = true;
  $("ticketError").hidden = false;
  $("ticketErrorMessage").textContent = message;
  $("retryTicket").hidden = !retry;
  $("ticketHeading").textContent = "Biletini kontrol edelim";
}

function drawDetails(event) {
  const details = $("ticketDetails");
  details.replaceChildren();
  for (const [label, value] of [["Tarih ve saat", ticketDateLabel(event)], ["Konum", event?.location]]) {
    if (!value) continue;
    const item = document.createElement("div"), term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    details.append(item);
  }
}

async function loadTicket() {
  const version = ++requestVersion;
  controller?.abort();
  controller = new AbortController();
  currentTicket = null;
  filesPromise = null;
  releaseImage();
  $("ticketContent").hidden = true;
  $("ticketError").hidden = true;
  $("ticketLoading").hidden = false;
  $("ticketHeading").textContent = "Biletin hazırlanıyor";
  $("ticketDownloadStatus").textContent = "";
  const code = readCode();
  if (!validDigitalTicketCode(code)) {
    showError("Bu bağlantıda geçerli bir bilet kodu bulunamadı. Organizatörün gönderdiği bilet bağlantısını tam olarak açmalısın.", false);
    return;
  }
  try {
    const response = await fetch("/api/public-ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    let result;
    try { result = await response.json(); } catch { throw new Error("Bilet servisine ulaşılamadı. Biraz sonra yeniden deneyebilirsin."); }
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) throw Object.assign(new Error("Bu bilet bulunamadı veya artık kullanılamıyor. Organizatörle iletişime geçebilirsin."), { retryable: false });
      throw new Error(response.status === 429 ? "Çok fazla deneme yapıldı. Lütfen biraz sonra yeniden dene." : "Bilet şu anda kontrol edilemiyor. Biraz sonra yeniden deneyebilirsin.");
    }
    if (result?.ticket?.code !== code || !result?.event || typeof result.ticket.eventTitle !== "string") throw new Error("Bilet bilgileri alınamadı. Lütfen yeniden dene.");
    const options = { code, eventTitle: result.ticket.eventTitle, event: result.event, design: result.design || null };
    const canvas = await renderTicketImage(options);
    const image = await ticketCanvasBlob(canvas);
    if (version !== requestVersion) return;
    imageUrl = URL.createObjectURL(image);
    $("ticketImage").src = imageUrl;
    $("ticketImage").alt = `${result.ticket.eventTitle} etkinliği için girişte gösterilecek QR biletin`;
    await $("ticketImage").decode();
    if (version !== requestVersion) return;
    currentTicket = { ...options, canvas };
    $("ticketHeading").textContent = result.ticket.eventTitle;
    $("claimTicket").href = ticketClaimUrl(code);
    drawDetails(result.event);
    $("ticketLoading").hidden = true;
    $("ticketContent").hidden = false;
    $("downloadTicketImage").disabled = false;
    $("downloadTicketPdf").disabled = false;
  } catch (error) {
    if (version !== requestVersion || error.name === "AbortError") return;
    releaseImage();
    showError(error.message || "Bilet açılamadı. Lütfen yeniden dene.", error.retryable !== false);
  }
}

async function download(type) {
  if (!currentTicket) return;
  const version = requestVersion;
  $("downloadTicketImage").disabled = true;
  $("downloadTicketPdf").disabled = true;
  $("ticketDownloadStatus").textContent = "Bilet dosyan hazırlanıyor…";
  try {
    filesPromise ||= createTicketFiles(currentTicket).catch(error => { filesPromise = null; throw error; });
    const files = await filesPromise;
    if (version !== requestVersion) return;
    downloadTicketFile(files[type]);
    $("ticketDownloadStatus").textContent = "Bilet dosyan hazır. İndirmelerini kontrol edebilirsin.";
  } catch (error) {
    if (version === requestVersion) $("ticketDownloadStatus").textContent = error.message || "Dosya indirilemedi. Lütfen yeniden dene.";
  } finally {
    if (version === requestVersion) {
      $("downloadTicketImage").disabled = false;
      $("downloadTicketPdf").disabled = false;
    }
  }
}

$("retryTicket").addEventListener("click", loadTicket);
$("downloadTicketImage").addEventListener("click", () => download("image"));
$("downloadTicketPdf").addEventListener("click", () => download("pdf"));
window.addEventListener("hashchange", loadTicket);
window.addEventListener("pagehide", () => { controller?.abort(); releaseImage(); });
// The bfcache retains the page, but pagehide releases its private image URL.
window.addEventListener("pageshow", event => { if (event.persisted) loadTicket(); });
loadTicket();
