const KEY = 'ercupsa_privacy_preferences_v1';
const VERSION = 1;
let memory;

function storedPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value?.version === VERSION && typeof value.instagram === 'boolean' ? value : null;
  } catch { return null; }
}
export function instagramAllowed() {
  return (memory ?? storedPreference())?.instagram === true;
}
export function setInstagramPreference(allowed) {
  const value = { version: VERSION, instagram: allowed === true, savedAt: new Date().toISOString() };
  memory = value;
  let persisted = false;
  try { localStorage.setItem(KEY, JSON.stringify(value)); persisted = true; } catch { /* The explicit choice still applies to this page. */ }
  window.dispatchEvent(new CustomEvent('ercupsa-privacy-change', { detail: { instagram: value.instagram, persisted } }));
}
export function mountPrivacyPreferences(host) {
  if (!host) return;
  let expanded = !storedPreference();
  host.innerHTML = `<div class="privacy-preferences-summary"><div><strong>Instagram içerik tercihi</strong><p data-privacy-state></p></div><button type="button" data-privacy-edit>Tercihimi değiştir</button></div><div data-privacy-options><h3>Instagram paylaşımlarını burada görmek ister misin?</h3><p>İzin verirsen gömülü Instagram içerikleri yüklenir. IP adresin ve tarayıcı bilgilerin Meta’ya iletilebilir; Instagram kendi çerezlerini kullanabilir. İzin vermeden de siteyi kullanabilir ve paylaşımları Instagram bağlantılarından açabilirsin.</p><div class="privacy-preferences-actions"><button type="button" data-privacy-allow>Instagram içeriklerine izin ver</button><button type="button" data-privacy-deny>Şimdilik gösterme</button><a href="cerezler.html">Kullanılan teknolojiler</a></div></div><p class="privacy-storage-note" data-privacy-storage hidden>Tercihin bu sayfada geçerli. Tarayıcın tercihi sonraki ziyaretler için saklayamadı.</p>`;
  function render(persisted = true) {
    const allowed = instagramAllowed();
    host.querySelector('[data-privacy-state]').textContent = allowed ? 'Instagram içeriklerine izin verdin. İznini istediğin zaman geri alabilirsin.' : 'Gömülü Instagram içerikleri kapalı. Doğrudan bağlantılar kullanılabilir.';
    host.querySelector('[data-privacy-options]').hidden = !expanded;
    host.querySelector('[data-privacy-edit]').hidden = expanded;
    host.querySelector('[data-privacy-deny]').textContent = allowed ? 'İznimi geri al' : 'Şimdilik gösterme';
    host.querySelector('[data-privacy-storage]').hidden = persisted;
  }
  host.querySelector('[data-privacy-edit]').onclick = () => { expanded = true; render(); host.querySelector('[data-privacy-options] h3').tabIndex = -1; host.querySelector('[data-privacy-options] h3').focus(); };
  for (const [selector, allowed] of [['[data-privacy-allow]', true], ['[data-privacy-deny]', false]]) {
    host.querySelector(selector).onclick = () => { expanded = false; setInstagramPreference(allowed); host.querySelector('[data-privacy-edit]').focus(); };
  }
  window.addEventListener('ercupsa-privacy-change', event => render(event.detail?.persisted !== false));
  render();
}
window.addEventListener('storage', event => {
  if (event.key !== KEY && event.key !== null) return;
  memory = undefined;
  window.dispatchEvent(new CustomEvent('ercupsa-privacy-change', { detail: { instagram: instagramAllowed(), persisted: true } }));
});
