// Homepage navigation stays independent of the shared shell used by the gallery.
const nav = document.querySelector('.home-nav');
const button = document.getElementById('siteMenuButton');
const menu = document.getElementById('siteMenu');
const desktop = matchMedia('(min-width: 900px)');
let open = false;

function setOpen(value, restoreFocus = false) {
  open = !desktop.matches && value;
  if (menu) menu.hidden = !desktop.matches && !open;
  if (button) button.setAttribute('aria-expanded', String(open));
  if (restoreFocus) button?.focus();
}
button?.addEventListener('click', () => setOpen(!open));
menu?.addEventListener('click', event => { if (event.target.closest('a[href]')) setOpen(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false, true); }
});
document.addEventListener('pointerdown', event => { if (open && !nav?.contains(event.target)) setOpen(false); });
nav?.addEventListener('focusout', event => {
  if (open && event.relatedTarget && !nav.contains(event.relatedTarget)) setOpen(false);
});
desktop.addEventListener('change', () => setOpen(false));
setOpen(false);

const themeButtons = document.querySelectorAll('.home-page .theme-toggle');
const updateTheme = () => themeButtons.forEach(button => button.setAttribute('aria-pressed', String(document.documentElement.classList.contains('dark'))));
themeButtons.forEach(button => button.addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('ercupsa-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); } catch { /* Theme still works when storage is blocked. */ }
  updateTheme();
}));
updateTheme();
document.querySelectorAll('[data-home-year]').forEach(element => {
  element.textContent = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Istanbul', year: 'numeric' }).format(new Date());
});
