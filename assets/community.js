import { $, escape, api, status } from "./common.js";
async function load() {
  try {
    const d = await api("/api/community");
    if ($("members"))
      $("members").innerHTML =
        d.members
          .map(
            (m) =>
              `<article class="glass-panel rounded-2xl p-6"><h2 class="text-xl font-bold">${escape(m.name)}</h2><p class="text-gray-500 mt-2">${escape(m.class)}${/^\d$/.test(m.class) ? ". sınıf" : ""}</p></article>`,
          )
          .join("") || "<p>Üye listesi yakında burada.</p>";
    if ($("experiences"))
      $("experiences").innerHTML =
        d.experiences
          .map(
            (e) =>
              `<article class="glass-panel rounded-2xl p-6"><span class="badge-chip text-sm">Anonim deneyim</span><h3 class="font-bold text-xl mt-3">${escape(e.title)}</h3><p class="mt-3 whitespace-pre-wrap">${escape(e.content)}</p></article>`,
          )
          .join("") || "<p>İlk deneyimi sen paylaşabilirsin.</p>";
  } catch (e) {
    status(e.message, true);
  }
}
$("submissionForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("/api/community?action=submit", {
      method: "POST",
      body: JSON.stringify({
        kind: $("kind").value,
        title: $("submissionTitle").value,
        content: $("content").value,
        website: $("website").value,
      }),
    });
    e.target.reset();
    status(
      "Gönderin alındı. Yönetim incelemesinden sonra uygun deneyimler yayımlanacak.",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    btn.disabled = false;
  }
});
load();
