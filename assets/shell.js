const links = [
  ["index.html", "Ana Sayfa"],
  ["etkinlikler.html", "Etkinlikler"],
  ["galeri.html", "Galeri"],
  ["test.html", "Test"],
  ["topluluk.html", "Topluluk"],
  ["uyeler.html", "Aktif Üyelerimiz"],
  ["biletler.html", "Biletlerim"],
];
const current = location.pathname.split("/").pop() || "index.html";
document.querySelectorAll("nav").forEach((nav) => {
  nav.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4"><a href="index.html" id="logoLink" class="flex items-center gap-3 shrink-0 text-ercupsaRed"><span class="h-12 w-12 rounded-full bg-white overflow-hidden border shadow-sm"><img src="ercupsa.PNG" width="48" height="48" alt="ERCUPSA logosu" class="w-full h-full object-cover"></span><span class="font-black text-xl">ERCUPSA</span></a><button type="button" id="siteMenuButton" aria-expanded="false" aria-controls="siteMenu" class="md:hidden border rounded-xl p-2">Menü</button><div id="siteMenu" class="hidden md:flex flex-wrap items-center gap-4">${links.map(([url, label]) => `<a href="${url}" ${url === current ? 'aria-current="page"' : ""} class="text-sm font-semibold ${url === current ? "text-ercupsaRed" : ""}">${label}</a>`).join("")}<button class="theme-toggle border rounded-xl px-2 py-1" aria-label="Temayı değiştir">◐</button></div></div>`;
  const btn = nav.querySelector("#siteMenuButton");
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    nav.querySelector("#siteMenu").classList.toggle("hidden", !open);
  });
});
document.querySelectorAll("footer").forEach((f) => {
  f.innerHTML =
    "<p>© " +
    new Date().getFullYear() +
    ' ERCUPSA · Erciyes Üniversitesi Eczacılık Öğrenci Topluluğu</p><div class="flex flex-wrap gap-4 justify-center mt-4 text-sm"><a href="hakkimizda.html">Hakkımızda</a><a href="ekip.html">Ekibimiz</a><a href="sss.html">SSS</a><a href="iletisim.html">İletişim</a></div>';
});
try {
  if (localStorage.getItem("ercupsa-theme") === "dark")
    document.documentElement.classList.add("dark");
} catch {}
