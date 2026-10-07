export function createEventFeedback({ request }) {
  const dialog = document.createElement("dialog");
  dialog.id = "eventFeedbackDialog";
  dialog.className = "event-feedback-dialog";
  dialog.setAttribute("aria-labelledby", "eventFeedbackTitle");
  dialog.innerHTML = `<header><h2 id="eventFeedbackTitle">Etkinliği değerlendir</h2><button type="button" id="eventFeedbackClose" aria-label="Değerlendirmeyi kapat">Kapat</button></header>
    <p class="event-feedback-private">Puanın ve yorumun yalnızca yönetim ekibiyle paylaşılır. Her etkinlik için bir değerlendirme bırakabilir, sonra düzenleyebilirsin.</p>
    <p id="eventFeedbackMessage" role="status" aria-live="polite"></p>
    <form id="eventFeedbackForm"><fieldset id="eventFeedbackFields" disabled><fieldset class="event-feedback-rating"><legend>Etkinliğe kaç puan verirsin? <span>(zorunlu)</span></legend>${[1, 2, 3, 4, 5].map((rating) => `<label><input type="radio" name="eventFeedbackRating" value="${rating}" required><span>${rating} <span aria-hidden="true">★</span></span></label>`).join("")}<p>1: Çok kötü · 5: Çok iyi</p></fieldset><label for="eventFeedbackComment">Yorumun <span>(isteğe bağlı)</span></label><textarea id="eventFeedbackComment" maxlength="2000" rows="5" placeholder="Neyi sevdin, bir sonraki etkinlikte neyi geliştirebiliriz?"></textarea><p class="event-feedback-private">En fazla 2.000 karakter.</p><button id="eventFeedbackSubmit" type="submit">Değerlendirmeyi kaydet</button></fieldset></form>`;
  document.body.append(dialog);
  const fields = dialog.querySelector("#eventFeedbackFields"), form = dialog.querySelector("form");
  const message = dialog.querySelector("#eventFeedbackMessage"), button = dialog.querySelector("#eventFeedbackSubmit");
  let identity = null, eventId = "", version = 0, available = false, opener = null;

  function notice(value, error = false) { message.textContent = value; message.dataset.error = String(error); }
  function close() { if (dialog.open) dialog.close(); }
  dialog.querySelector("#eventFeedbackClose").onclick = close;
  dialog.addEventListener("close", () => {
    // A queued close from an older dialog must not cancel a newly opened one.
    if (dialog.open) return;
    version++; fields.disabled = true;
    opener?.isConnected && !opener.closest("[hidden]") && opener.focus();
  });
  function reset() {
    version++;
    close();
    form.reset(); eventId = ""; available = false; fields.disabled = true;
    notice(""); opener = null;
  }
  function setIdentity(value) { if (value !== identity) { reset(); identity = value; } }
  function populate(saved) {
    form.reset();
    // Fields stay disabled during loading; click() cannot select a disabled radio.
    const selected = saved?.rating && dialog.querySelector(`input[value="${Number(saved.rating)}"]`);
    if (selected) selected.checked = true;
    dialog.querySelector("#eventFeedbackComment").value = saved?.comment || "";
    button.textContent = saved ? "Değerlendirmeyi güncelle" : "Değerlendirmeyi kaydet";
  }
  async function open(id, title) {
    if (!identity) return;
    if (dialog.open) close();
    eventId = id; available = false; opener = document.activeElement;
    fields.disabled = true; form.reset(); notice("Değerlendirme yükleniyor…");
    // textContent prevents event titles from becoming HTML inside the dialog.
    dialog.querySelector("h2").textContent = title || "Etkinliği değerlendir";
    dialog.showModal();
    const current = ++version;
    try {
      const result = await request(`/api/feedback?eventId=${encodeURIComponent(id)}`);
      if (current !== version || !dialog.open || !identity) return;
      populate(result.feedback);
      available = result.available === true;
      fields.disabled = !available;
      notice(result.message || (result.feedback ? "Değerlendirmeni düzenleyebilirsin." : "Puanını seç, dilersen bir yorum ekle."));
      if (available) dialog.querySelector('input[type="radio"]')?.focus();
    } catch (error) { if (current === version && identity) notice(error.message, true); }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!identity || !available || fields.disabled) return;
    const selected = form.querySelector('input[name="eventFeedbackRating"]:checked');
    if (!selected) { notice("1 ile 5 arasında bir puan seçmelisin.", true); return; }
    const input = { eventId, rating: Number(selected.value), comment: dialog.querySelector("textarea").value };
    const current = ++version;
    fields.disabled = true; notice("Değerlendirmen kaydediliyor…");
    try {
      const result = await request("/api/feedback", { method: "POST", body: JSON.stringify(input) });
      if (current !== version || !dialog.open || !identity) return;
      populate(result.feedback); notice("Teşekkür ederiz! Değerlendirmen kaydedildi.");
    } catch (error) { if (current === version && identity) notice(error.message, true); }
    finally { if (current === version && dialog.open && identity) fields.disabled = !available; }
  });
  return { open, reset, setIdentity };
}
