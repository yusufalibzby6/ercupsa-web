export const $ = (id) => document.getElementById(id);
// admin.js and the bundled panels have separate module copies. Keep readiness
// shared so a panel loaded after the first fetch still receives the current state.
const adminState = globalThis[Symbol.for("ercupsa.admin.state")] ||= {
  events: null,
  ready: false,
  session: null,
};
const permissions = new Set([
  "events.view", "events.manage", "events.publish", "registrations.view", "registrations.manage", "registrations.receipts", "registrations.photos", "registrations.export",
  "tickets.view", "tickets.manage", "raffles.view", "raffles.manage", "attendance.view", "attendance.manage", "accounts.view", "accounts.manage", "instagram.view", "instagram.manage",
]);
export function getAdminSession() { return adminState.session ? structuredClone(adminState.session) : null; }
export function setAdminSession(session) {
  // Only the authenticated session endpoint supplies this value. A missing or
  // malformed response must never confer owner privileges.
  const valid = session && typeof session.id === "string" && session.id && typeof session.username === "string" && session.username &&
    typeof session.name === "string" && ["owner", "admin", "treasurer"].includes(session.role) && Array.isArray(session.permissions);
  adminState.session = valid ? { id: session.id, username: session.username, name: session.name, role: session.role,
    permissions: [...new Set(session.permissions.filter(permission => permissions.has(permission)))] } : null;
  adminState.ready = false;
  document.dispatchEvent(new CustomEvent("admin-session", { detail: getAdminSession() }));
  return getAdminSession();
}
export function isOwner() { return adminState.session?.role === "owner"; }
export function canAdmin(permission) { return !!adminState.session && (isOwner() || adminState.session.permissions.includes(permission)); }
if (typeof document !== "undefined" && !adminState.logoutListener) {
  adminState.logoutListener = true;
  document.addEventListener("admin-logout", () => {
    adminState.session = null; adminState.ready = false; adminState.events = null;
    document.dispatchEvent(new CustomEvent("admin-session", { detail: null }));
  });
}
export function announceAdminEvents(events) {
  adminState.events = events;
  document.dispatchEvent(new CustomEvent("events-loaded", { detail: events }));
}
export function announceAdminReady() {
  if (!adminState.session) return;
  adminState.ready = true;
  document.dispatchEvent(new Event("admin-ready"));
}
export function onAdminEvent(name, listener) {
  document.addEventListener(name, listener);
  if (name === "events-loaded" && adminState.events !== null)
    listener(new CustomEvent(name, { detail: adminState.events }));
  if (name === "admin-ready" && adminState.ready) listener(new Event(name));
  if (name === "admin-session") listener(new CustomEvent(name, { detail: getAdminSession() }));
}
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const safeImage = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname === "res.cloudinary.com"
      ? escape(u.href)
      : "";
  } catch {
    return "";
  }
};
export async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "İşlem tamamlanamadı.");
  return d;
}
export function status(message, err = false) {
  const el = $("status");
  if (el) {
    el.textContent = message;
    el.classList.toggle("text-red-700", err);
  }
}
export function busy(button, fn) {
  return async () => {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      status(e.message, true);
    } finally {
      button.disabled = false;
    }
  };
}
