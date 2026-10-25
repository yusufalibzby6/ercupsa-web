const announcement = document.getElementById('homeYearbookAnnouncement');
if (announcement) {
  fetch('/api/yearbooks', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(async response => {
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.yearbooks)) return;
    const books = data.yearbooks.filter(book => book && /^[A-Za-z0-9_-]{1,100}$/.test(book.id || '') &&
      typeof book.title === 'string' && book.title.trim() && book.title.length <= 200 &&
      typeof book.publishedAt === 'string' && Number.isFinite(Date.parse(book.publishedAt)) && book.published !== false)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (!books.length) return;
    const book = books[0];
    document.getElementById('homeYearbookTitle').textContent = book.title;
    document.getElementById('homeYearbookDescription').textContent = typeof book.description === 'string' ? book.description.slice(0, 500) : '';
    document.getElementById('homeYearbookLink').href = `yillik.html?donem=${encodeURIComponent(book.id)}`;
    announcement.hidden = false;
  }).catch(() => { /* No announcement is shown when publication cannot be verified. */ });
}
