document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  try { if (localStorage.getItem('ercupsa-welcome-seen')) return; } catch {}
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const background = [...document.body.children].filter(el => el !== modal && !['SCRIPT', 'STYLE'].includes(el.tagName));
  const previousInert = background.map(el => el.inert);
  background.forEach(el => { el.inert = true; });
  document.body.style.overflow = 'hidden';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  const dismiss = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = previousOverflow;
    background.forEach((el, i) => { el.inert = previousInert[i]; });
    document.removeEventListener('keydown', onKeydown);
    try { localStorage.setItem('ercupsa-welcome-seen', '1'); } catch {}
    const focusTarget = previousFocus !== document.body ? previousFocus : document.getElementById('discoverEvents');
    focusTarget?.focus();
  };
  const onKeydown = event => {
    if (event.key === 'Escape') dismiss();
    if (event.key !== 'Tab') return;
    const items = [...modal.querySelectorAll('a[href], button:not([disabled])')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.getElementById('closeWelcome').addEventListener('click', dismiss);
  document.getElementById('continueSite').addEventListener('click', dismiss);
  modal.addEventListener('click', event => { if (event.target === modal) dismiss(); });
  document.addEventListener('keydown', onKeydown);
  document.getElementById('closeWelcome').focus();
});
