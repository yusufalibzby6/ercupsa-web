import { createClient } from "@supabase/supabase-js";
import { $, escape, api, status } from "./common.js";
let client, session;
async function account(path, opts = {}) {
  return api("/api/community?action=" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + session.access_token },
  });
}
async function refresh() {
  $("authPanel").hidden = Boolean(session);
  $("accountPanel").hidden = !session;
  if (!session) return;
  const d = await account("me");
  $("name").value = d.profile?.name || "";
  $("publicName").checked = d.profile?.public_name || false;
  $("badge").textContent =
    `${d.badge ? d.badge + " rozet" : "Rozet yolculuğun"} · ${d.total} etkinlik`;
  $("attendance").innerHTML =
    d.attendance
      .map(
        (a) =>
          `<article class="glass-panel p-4 rounded-xl">${escape(a.event_title)}</article>`,
      )
      .join("") ||
    "<p>Henüz bilet eklemedin. Önce adını kaydet, ardından etkinlik biletini ekle.</p>";
}
function form(id, fn) {
  $(id).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      if (!client) throw Error("Hesap bölümü henüz kullanıma açılmadı.");
      await fn();
    } catch (e) {
      status(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
form("emailForm", async () => {
  const { error } = await client.auth.signInWithOtp({
    email: $("email").value.trim(),
  });
  if (error) throw error;
  $("otpForm").hidden = false;
  status("Doğrulama kodunu e-postana gönderdik.");
});
form("otpForm", async () => {
  const { data, error } = await client.auth.verifyOtp({
    email: $("email").value.trim(),
    token: $("otp").value.trim(),
    type: "email",
  });
  if (error) throw error;
  session = data.session;
  await refresh();
  status("Giriş yaptın.");
});
form("profileForm", async () => {
  await account("me", {
    method: "POST",
    body: JSON.stringify({
      name: $("name").value,
      public_name: $("publicName").checked,
    }),
  });
  status("Bilgilerin kaydedildi.");
  await refresh();
});
form("claimForm", async () => {
  await account("claim", {
    method: "POST",
    body: JSON.stringify({ code: $("ticketCode").value }),
  });
  $("ticketCode").value = "";
  await refresh();
  status("Biletin eklendi.");
  await board();
});
$("logout").addEventListener("click", async () => {
  await client.auth.signOut();
  session = null;
  await refresh();
  status("Çıkış yaptın.");
});
async function board() {
  try {
    const d = await api("/api/community");
    $("board").innerHTML =
      d.board
        .map(
          (p) =>
            `<article class="glass-panel rounded-2xl p-5"><strong>${escape(p.name)}</strong><p>${escape(p.badge)} rozet · ${Number(p.total)} etkinlik</p></article>`,
        )
        .join("") || "<p>İlk rozet sahiplerimiz yakında burada.</p>";
  } catch (e) {
    $("board").textContent = e.message;
  }
}
async function init() {
  try {
    const c = await api("/api/community?action=config");
    if (!c.url || !c.key) throw Error("Hesap bölümü henüz kullanıma açılmadı.");
    client = createClient(c.url, c.key, {
      auth: { persistSession: false, detectSessionInUrl: false },
    });
    session = (await client.auth.getSession()).data.session;
    const code = new URLSearchParams(location.search).get("code");
    if (code) $("ticketCode").value = code;
    await refresh();
  } catch (e) {
    status(e.message, true);
  }
  await board();
}
init();
