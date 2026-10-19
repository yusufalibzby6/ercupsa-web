const grid = document.getElementById("teamCards");
const safePhoto = value => typeof value === "string" && (/^(?:danisman-hoca\.jpg|ekip(?:[1-9]|1[0-9]|20)\.(?:jpg|JPG)|assets\/team\/belinay-das\.webp)$/.test(value) || /^\/api\/team\?action=photo&id=[a-f0-9]{64}$/.test(value));
function card(member) {
  const el = document.createElement("div");
  el.className = "glass-panel rounded-3xl p-6 flex flex-col items-center text-center transition-all duration-300 hover:-translate-y-2 hover:shadow-xl group";
  if (member.featured) el.classList.add("sm:col-span-2", "md:col-span-3", "lg:col-span-4");
  const visual = document.createElement("div"); visual.className = "w-28 h-28 rounded-full overflow-hidden mb-4 shadow-md bg-gray-100 flex items-center justify-center relative p-[3px]";
  visual.style.background = member.featured ? "linear-gradient(135deg,#1A1A1A,#8B2323)" : "linear-gradient(135deg,#A62B2B,#E23E4E)";
  if (member.photo) {
    const image = document.createElement("img"); image.src = member.photo; image.alt = member.name; image.decoding = "async"; image.loading = "lazy"; image.width = 112; image.height = 112; image.className = "w-full h-full object-cover rounded-full border-2 border-white"; visual.append(image);
  } else {
    const initial = document.createElement("span"); initial.textContent = member.name.slice(0, 1); initial.style.cssText = "color:white;font-size:2rem;font-weight:700"; initial.setAttribute("aria-hidden", "true"); visual.append(initial);
  }
  const name = document.createElement("h3"); name.className = "text-lg font-bold text-ercupsaDark group-hover:text-ercupsaRed transition"; name.textContent = member.name;
  const role = document.createElement("p"); role.className = member.featured ? "text-ercupsaDark font-bold text-xs mt-1 uppercase tracking-wider" : "text-ercupsaRed font-medium text-xs mt-1 uppercase tracking-wider"; role.textContent = member.role;
  el.append(visual, name, role); return el;
}
if (grid) {
  fetch("/api/team", { signal: AbortSignal.timeout(12000) }).then(async response => {
    if (!response.ok) throw Error();
    const data = await response.json(), ids = new Set();
    if (!Array.isArray(data.members) || data.members.length > 100 || data.members.some(member => {
      if (!member || typeof member.id !== "string" || ids.has(member.id) || typeof member.name !== "string" || !member.name.trim() ||
          typeof member.role !== "string" || !member.role.trim() || typeof member.featured !== "boolean" || typeof member.photo !== "string" || (member.photo && !safePhoto(member.photo))) return true;
      ids.add(member.id); return false;
    })) throw Error();
    grid.replaceChildren(...data.members.map(card));
    const intro = document.getElementById("teamIntro");
    if (intro) intro.textContent = data.members.length ? "Birliğimizi geleceğe taşıyan, projelerimizi hayata geçiren yönetim ve koordinasyon ekibimiz." : "Ekibimiz yakında burada sizlerle olacak.";
  }).catch(() => { /* Keep the complete static roster when the content service is unavailable. */ });
}
