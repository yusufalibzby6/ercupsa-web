import QRCode from "qrcode";
import { $, escape, api, status } from "./common.js";
let data = { members: [], submissions: [], batches: [] };
const tabs = ["events", "members", "suggestions", "experiences", "tickets"];
function tab(name) {
  for (const t of tabs) $(t + "Tab").hidden = t !== name;
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
document.addEventListener("events-loaded", (e) => {
  $("ticketEvent").innerHTML = e.detail
    .map((v) => `<option value="${escape(v.id)}">${escape(v.title)}</option>`)
    .join("");
});
document.addEventListener("ticket-event", (e) => {
  tab("tickets");
  $("ticketEvent").value = e.detail.id;
});
async function load() {
  try {
    data = await api("/api/community?action=admin");
    render();
  } catch (e) {
    status(e.message, true);
  }
}
document.addEventListener("admin-ready", load);
function render() {
  $("memberList").innerHTML =
    data.members
      .map(
        (m) =>
          `<article class="card rounded-xl p-4 flex justify-between gap-3"><div>${escape(m.name)} · ${escape(m.class)}</div><div><button data-member="${m.id}">Düzenle</button> <button data-delete="${m.id}" class="text-red-700">Sil</button></div></article>`,
      )
      .join("") || "<p>Henüz üye eklenmedi.</p>";
  for (const [kind, target] of [
    ["suggestion", "suggestionList"],
    ["experience", "experienceList"],
  ])
    $(target).innerHTML =
      data.submissions
        .filter((s) => s.kind === kind)
        .map(
          (s) =>
            `<article class="card rounded-2xl p-5"><h3 class="font-bold text-xl">${escape(s.title)}</h3><p class="whitespace-pre-wrap my-3">${escape(s.content)}</p><p class="text-sm text-gray-500">${{ pending: "Bekliyor", approved: kind === "experience" ? "Yayımlandı" : "Değerlendirildi", rejected: "Reddedildi" }[s.status]}</p><div class="flex gap-3 mt-3"><button data-moderate="${s.id}" data-state="approved" class="border rounded-xl p-2">${kind === "experience" ? "Onayla ve yayımla" : "Değerlendirildi olarak işaretle"}</button><button data-moderate="${s.id}" data-state="rejected" class="border rounded-xl p-2">${kind === "experience" ? "Reddet / yayından kaldır" : "Reddet"}</button><button data-moderate="${s.id}" data-state="pending" class="border rounded-xl p-2">Beklemeye al</button></div></article>`,
        )
        .join("") || "<p>Henüz gönderi yok.</p>";
  $("batchList").innerHTML = data.batches
    .map(
      (b) =>
        `<button data-batch="${b.id}" class="card rounded-xl p-4 text-left">${escape(b.event_title)} · ${new Date(b.created_at).toLocaleString("tr-TR")} · Biletleri aç</button>`,
    )
    .join("");
}
$("memberForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("/api/community?action=member", {
      method: "POST",
      body: JSON.stringify({
        id: $("memberId").value || undefined,
        name: $("memberName").value,
        class: $("memberClass").value,
      }),
    });
    e.target.reset();
    status("Üye kaydedildi.");
    await load();
  } catch (e) {
    status(e.message, true);
  } finally {
    btn.disabled = false;
  }
});
$("memberReset").onclick = () => {
  $("memberForm").reset();
  $("memberId").value = "";
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.member) {
      const m = data.members.find((m) => m.id === b.dataset.member);
      $("memberId").value = m.id;
      $("memberName").value = m.name;
      $("memberClass").value = m.class;
    }
    if (
      b.dataset.delete &&
      confirm("Üye listeden kaldırılacak. Devam edilsin mi?")
    ) {
      await api("/api/community?action=member&id=" + b.dataset.delete, {
        method: "DELETE",
      });
      await load();
    }
    if (b.dataset.moderate) {
      await api("/api/community?action=moderate", {
        method: "POST",
        body: JSON.stringify({
          id: b.dataset.moderate,
          status: b.dataset.state,
        }),
      });
      await load();
    }
    if (b.dataset.batch) await showBatch(b.dataset.batch);
    if (b.dataset.revoke && confirm("Bu bilet iptal edilsin mi?")) {
      await api("/api/community?action=revoke", {
        method: "POST",
        body: JSON.stringify({ id: b.dataset.revoke }),
      });
      await showBatch($("ticketOutput").dataset.batch);
    }
  } catch (e) {
    status(e.message, true);
  }
});
$("batchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  b.disabled = true;
  try {
    const d = await api("/api/community?action=batch", {
      method: "POST",
      body: JSON.stringify({
        event_id: $("ticketEvent").value,
        count: Number($("ticketCount").value),
      }),
    });
    await load();
    await showBatch(d.id);
    status(`${d.codes.length} bilet oluşturuldu.`);
  } catch (e) {
    status(e.message, true);
  } finally {
    b.disabled = false;
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
  const d = await api("/api/community?action=batch&id=" + id);
  $("ticketOutput").dataset.batch = id;
  const cards = [];
  for (const code of d.codes) {
    const digest = await hash(code),
      ticket = d.tickets.find((t) => t.code_hash === digest);
    const qr = await QRCode.toDataURL(
      location.origin + "/biletler.html?ticket=" + encodeURIComponent(code),
    );
    cards.push(
      `<article class="ticket card rounded-xl p-4 text-center"><h3 class="font-bold">${escape(d.event_title)}</h3><img src="${qr}" alt="Bilet QR kodu" class="w-32 mx-auto"><p class="font-mono text-xs break-all">${code}</p><p>${ticket?.revoked ? "İptal" : ticket?.claimed_at ? "Kullanıldı" : "Kullanılmadı"}</p>${ticket && !ticket.revoked && !ticket.claimed_at ? `<button class="no-print text-red-700" data-revoke="${ticket.id}">İptal et</button>` : ""}</article>`,
    );
  }
  $("ticketOutput").innerHTML =
    '<button id="printTickets" class="no-print btn-primary rounded-xl p-3 mb-4">Yazdır / PDF olarak kaydet</button><div class="ticket-grid grid sm:grid-cols-3 gap-4">' +
    cards.join("") +
    "</div>";
  $("printTickets").onclick = () => {
    document.body.classList.add("printing-tickets");
    window.print();
    document.body.classList.remove("printing-tickets");
  };
}
