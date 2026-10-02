import { createClient } from "@supabase/supabase-js";
import { $, escape, api, status } from "./common.js";
let client,
  session,
  recovering = false;
let authVersion = 0;
function authError(error) {
  const messages = {
    invalid_credentials: "E-posta veya şifre yanlış.",
    email_not_confirmed:
      "Hesabın henüz girişe açık değil. Lütfen yönetimle iletişime geç.",
    user_already_exists:
      "Bu e-posta ile bir hesap var. Giriş yapabilir veya şifreni sıfırlayabilirsin.",
    weak_password: "Daha güçlü bir şifre seç. En az 8 karakter kullan.",
    same_password: "Yeni şifren önceki şifrenden farklı olmalı.",
    over_request_rate_limit:
      "Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.",
    over_email_send_rate_limit:
      "E-posta gönderim sınırına ulaşıldı. Lütfen daha sonra tekrar dene.",
    email_address_invalid: "E-posta adresini kontrol et.",
    signup_disabled:
      "Yeni kayıtlar şu an kapalı. Lütfen daha sonra tekrar dene.",
  };
  if (messages[error.code]) return messages[error.code];
  // Older GoTrue responses may contain a message without a structured error code.
  if (/invalid login credentials/i.test(error.message || "")) return messages.invalid_credentials;
  if (/email not confirmed/i.test(error.message || "")) return messages.email_not_confirmed;
  if (/sending.*email/i.test(error.message || ""))
    return "E-posta şu an gönderilemiyor. Lütfen daha sonra tekrar dene.";
  return "İşlem tamamlanamadı. Lütfen bilgilerini kontrol edip tekrar dene.";
}
function checkAuth(error) {
  if (error) throw new Error(authError(error));
}
function tab(name) {
  for (const mode of ["login", "signup", "forgot"])
    $(mode + "Form").hidden = mode !== name;
  for (const mode of ["login", "signup"]) {
    const selected = mode === name;
    $(mode + "Tab").setAttribute("aria-selected", String(selected));
    $(mode + "Tab").classList.toggle("btn-primary", selected);
    $(mode + "Tab").classList.toggle("border", !selected);
  }
  status("");
}
$("loginTab").onclick = () => tab("login");
$("signupTab").onclick = () => tab("signup");
$("forgotLink").onclick = () => {
  $("forgotEmail").value = $("loginEmail").value;
  tab("forgot");
};
$("backToLogin").onclick = () => tab("login");
async function account(path, opts = {}) {
  if (!session) throw new Error("Önce giriş yapmalısın.");
  return api("/api/community?action=" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + session.access_token },
  });
}
function metadataName() {
  const data = session?.user?.user_metadata || {};
  return [data.first_name, data.last_name]
    .filter((v) => typeof v === "string")
    .join(" ")
    .trim()
    .slice(0, 120);
}
async function refresh() {
  const version = ++authVersion;
  $("authPanel").hidden = Boolean(session);
  $("resetPanel").hidden = !session || !recovering;
  $("accountPanel").hidden = !session || recovering;
  if (!session || recovering) return;
  const d = await account("me");
  if (version !== authVersion || !session) return;
  $("name").value = d.profile?.name || metadataName();
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
    "<p>Henüz bilet eklemedin. Etkinlik biletini ekleyerek başlayabilirsin.</p>";
}
function form(id, fn) {
  $(id).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(
      'button[type="submit"], button:not([type])',
    );
    btn.disabled = true;
    try {
      if (!client) throw new Error("Hesap bölümü henüz kullanıma açılmadı.");
      await fn();
    } catch (error) {
      status(error.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
function password(value, repeated) {
  if (value.length < 8 || value.length > 128)
    throw new Error("Şifre 8–128 karakter arasında olmalı.");
  if (value !== repeated) throw new Error("Şifreler eşleşmiyor.");
}
form("loginForm", async () => {
  const { data, error } = await client.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value,
  });
  checkAuth(error);
  session = data.session;
  recovering = false;
  $("loginPassword").value = "";
  await refresh();
  status("Giriş yaptın.");
});
form("signupForm", async () => {
  const firstName = $("firstName").value.trim(),
    lastName = $("lastName").value.trim(),
    fullName = `${firstName} ${lastName}`;
  if (!firstName || !lastName || fullName.length > 120)
    throw new Error("İsim ve soyisim toplamı en fazla 120 karakter olmalı.");
  password($("signupPassword").value, $("signupPasswordAgain").value);
  const { data, error } = await client.auth.signUp({
    email: $("signupEmail").value.trim(),
    password: $("signupPassword").value,
    options: { data: { first_name: firstName, last_name: lastName } },
  });
  checkAuth(error);
  if (!data.session)
    throw new Error(
      "Hesabın henüz girişe açık değil. Lütfen yönetimle iletişime geç.",
    );
  session = data.session;
  recovering = false;
  $("signupForm").reset();
  await refresh();
  await account("me", {
    method: "POST",
    body: JSON.stringify({ name: fullName, public_name: false }),
  });
  await refresh();
  status("Hesabın oluşturuldu. Biletini ekleyebilirsin.");
});
form("forgotForm", async () => {
  const redirect = new URL("biletler.html", location.href);
  redirect.search = "recovery=1";
  const { error } = await client.auth.resetPasswordForEmail(
    $("forgotEmail").value.trim(),
    { redirectTo: redirect.href },
  );
  checkAuth(error);
  status(
    "Bu adresle bir hesap varsa şifre sıfırlama bağlantısı e-postana gönderilecek. Spam klasörünü de kontrol et.",
  );
});
form("resetForm", async () => {
  if (!session || !recovering)
    throw new Error("Şifre sıfırlama bağlantısını e-postandan açmalısın.");
  password($("newPassword").value, $("newPasswordAgain").value);
  const { error } = await client.auth.updateUser({
    password: $("newPassword").value,
  });
  checkAuth(error);
  $("resetForm").reset();
  recovering = false;
  history.replaceState(
    {},
    "",
    location.pathname +
      location.search
        .replace(/([?&])recovery=1(&|$)/, "$1")
        .replace(/[?&]$/, ""),
  );
  await client.auth.signOut();
  session = null;
  await refresh();
  tab("login");
  status("Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.");
});
form("profileForm", async () => {
  await account("me", {
    method: "POST",
    body: JSON.stringify({
      name: $("name").value,
      public_name: $("publicName").checked,
    }),
  });
  await refresh();
  status("Bilgilerin kaydedildi.");
});
form("claimForm", async () => {
  await account("claim", {
    method: "POST",
    body: JSON.stringify({ code: $("ticketCode").value }),
  });
  $("ticketCode").value = "";
  await refresh();
  await board();
  status("Biletin eklendi.");
});
$("logout").addEventListener("click", async () => {
  try {
    const { error } = await client.auth.signOut();
    checkAuth(error);
    session = null;
    recovering = false;
    await refresh();
    status("Çıkış yaptın.");
  } catch (error) {
    status(error.message, true);
  }
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
  } catch (error) {
    $("board").textContent = error.message;
  }
}
async function init() {
  try {
    const c = await api("/api/community?action=config");
    if (!c.url || !c.key)
      throw new Error("Hesap bölümü henüz kullanıma açılmadı.");
    // Ticket QR codes and Supabase PKCE callbacks must not share the code parameter.
    const params = new URLSearchParams(location.search);
    const ticket = params.get("ticket") || params.get("code");
    if (ticket?.startsWith("ERC-")) {
      $("ticketCode").value = ticket;
      if (params.get("code") === ticket) {
        params.delete("code");
        params.set("ticket", ticket);
        history.replaceState(
          {},
          "",
          location.pathname + "?" + params.toString() + location.hash,
        );
      }
    }
    client = createClient(c.url, c.key, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    client.auth.onAuthStateChange((event, next) => {
      session = next;
      if (event === "PASSWORD_RECOVERY") recovering = true;
      if (event === "SIGNED_OUT") recovering = false;
      // Never await another auth operation inside this callback (Supabase holds its auth lock).
      setTimeout(
        () => refresh().catch((error) => status(error.message, true)),
        0,
      );
    });
    const { data, error } = await client.auth.getSession();
    checkAuth(error);
    session = data.session;
    recovering =
      recovering ||
      Boolean(
        session && new URLSearchParams(location.search).get("recovery") === "1",
      );
    await refresh();
  } catch (error) {
    status(error.message, true);
  }
  await board();
}
init();
