export const $ = (id) => document.getElementById(id);
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
