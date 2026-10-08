import { escape } from "./common.js";
import { validateStoredDesign, ticketArtworkSource, holdTicketArtwork } from "./ticket-template.js";

export const TICKETS_PER_PAGE = 10;
const SLOGAN = "Sürpriz hediyeler sizi bekliyor.";

export function ticketCard({ code, qr, eventTitle, ticket, design = null, preview = false }) {
  const artwork = validateStoredDesign(design);
  const state = ticket?.revoked
    ? "İPTAL"
    : ticket?.claimed_at
      ? "HESABA EKLENDİ"
      : "KATILIM BİLETİ";
  return `<article class="ticket${artwork ? " ticket-custom" : ""}" data-code="${escape(code)}">
    ${artwork ? `<img class="ticket-artwork" src="${escape(ticketArtworkSource(artwork))}" alt="${escape(eventTitle)} etkinliğinin özel bilet tasarımı">` : `<div class="ticket-copy">
      <div class="ticket-brand"><img class="ticket-logo" src="ercupsa.PNG" alt="ERCUPSA logosu"><div><strong>ERCUPSA</strong><span>Etkinlik katılım bileti</span></div></div>
      <h3 class="ticket-title">${escape(eventTitle)}</h3>
      <p class="ticket-slogan">${SLOGAN}</p>
    </div>`}
    <div class="ticket-stub"><img class="${preview ? "ticket-preview-qr" : "ticket-qr"}" src="${escape(qr)}" alt="${preview ? "QR kodunun sabit konumu; gerçek kod baskıda otomatik eklenir" : "Bu bilete özel QR kodu"}">${artwork ? "" : `<p class="ticket-code"><span>${escape(code.slice(0, 16))}</span><span>${escape(code.slice(16))}</span></p><span class="ticket-state">${state}</span>`}</div>
  </article>`;
}

export function ticketSheets(cards, controls = []) {
  const pages = [];
  for (let i = 0; i < cards.length; i += TICKETS_PER_PAGE) {
    const slice = cards.slice(i, i + TICKETS_PER_PAGE);
    pages.push(`<section class="ticket-page" aria-label="Bilet sayfası ${pages.length + 1}">
      <p class="ticket-page-label no-print">Sayfa ${pages.length + 1} · ${slice.length} bilet</p>
      <div class="ticket-sheet">${slice.map((card, j) => `<div class="ticket-cell">${card}${controls[i + j] || ""}</div>`).join("")}</div>
    </section>`);
  }
  return pages.join("");
}

function fitTitles(root) {
  for (const title of root.querySelectorAll(".ticket-title")) {
    let size = 15;
    title.style.fontSize = `${size}px`;
    while (title.scrollHeight > title.clientHeight + 1 && size > 8) {
      size -= 0.5;
      title.style.fontSize = `${size}px`;
    }
  }
}

let printing = false;
let cancelActivePrint = null;
if (typeof document !== "undefined") document.addEventListener("admin-logout", () => cancelActivePrint?.());
export async function printTickets(cards, eventTitle, { signal } = {}) {
  if (printing) throw new Error("Önce devam eden bilet yazdırma işlemini tamamlayın.");
  signal?.throwIfAborted();
  printing = true;
  let root = document.getElementById("ticketPrintRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "ticketPrintRoot";
    document.body.append(root);
  }
  root.innerHTML = ticketSheets(cards);
  const releaseArtwork = [...new Set([...root.querySelectorAll(".ticket-artwork")].map(img => img.src))].map(holdTicketArtwork);
  const originalTitle = document.title;
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cancelActivePrint === abort) cancelActivePrint = null;
    printing = false;
    document.body.classList.remove("printing-tickets");
    root.classList.remove("preparing-print");
    document.title = originalTitle;
    window.removeEventListener("afterprint", cleanup);
    signal?.removeEventListener("abort", abort);
    root.innerHTML = "";
    releaseArtwork.forEach(release => release());
  };
  const abort = () => {
    cleanup();
    rejectAbort(signal?.reason || new DOMException("Yazdırma iptal edildi.", "AbortError"));
  };
  cancelActivePrint = abort;
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.race([
      Promise.all([...root.querySelectorAll("img")].map((img) => img.decode()))
        .then(() => document.fonts.ready),
      aborted,
    ]);
    signal?.throwIfAborted();
    if (cleaned) throw new DOMException("Yazdırma iptal edildi.", "AbortError");
    root.classList.add("preparing-print");
    document.title = `ERCUPSA - ${eventTitle} - Biletler`;
    document.body.classList.add("printing-tickets");
    fitTitles(root);
    window.addEventListener("afterprint", cleanup);
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
