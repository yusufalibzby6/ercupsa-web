import { test, expect } from '@playwright/test';
const events = [
  { id: 'one', title: 'Çekiliş gecesi', date: '2026-10-07', time: '18:00', images: [], published: true },
  { id: 'two', title: 'İkinci etkinlik', date: '2026-10-08', images: [], published: true },
];
const participants = [
  { id: 'a', name: 'Ada <img src=x onerror=alert(1)>', previous: 3, weight: 4 },
  { id: 'b', name: 'Bora Daş', previous: 0, weight: 1 },
  { id: 'c', name: 'Ceren Ergül', previous: 1, weight: 2 },
];
async function fixture(page, failFirst = false) {
  const state = { draws: [], requests: [], deletes: [], failed: false };
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked API' } }));
  await page.route('**/api/events*', route => route.fulfill({ json: { events } }));
  await page.route('**/api/community*', route => route.fulfill({ json: { submissions: [], batches: [] } }));
  await page.route('**/api/ticket-design*', route => route.fulfill({ json: { design: null } }));
  await page.route('**/api/registrations*', route => route.fulfill({ json: { form: null, summaries: [] } }));
  await page.route('**/api/raffles*', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      const selected = new URL(req.url()).searchParams.get('eventId');
      return route.fulfill({ json: { participants: selected === 'one' ? participants : [], draws: state.draws.filter(d => d.eventId === selected) } });
    }
    const input = req.postDataJSON();
    if (req.method() === 'DELETE') {
      state.deletes.push(input); state.draws = state.draws.filter(d => d.id !== input.id);
      return route.fulfill({ json: { ok: true } });
    }
    state.requests.push(input);
    let draw = state.draws.find(d => d.id === input.requestId);
    if (!draw) {
      const included = participants.filter(p => !input.excluded.includes(p.id));
      draw = { id: input.requestId, eventId: input.eventId, eventTitle: 'Çekiliş gecesi', participants: included, winners: included.slice(0, input.count), createdAt: '2026-10-07T18:00:00Z' };
      state.draws.unshift(draw);
    }
    if (failFirst && !state.failed) { state.failed = true; return route.fulfill({ status: 503, json: { error: 'Bağlantı kesildi.' } }); }
    return route.fulfill({ json: { draw } });
  });
  await page.goto('/admin.html');
  await page.locator('[data-tab=raffles]').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
  return state;
}
test('draw excludes people, reveals multiple unique winners after five seconds and saves/deletes/repeats', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('#raffleSummary')).toContainText('3 kişi dahil · 7 toplam hak');
  await expect(page.locator('#raffleParticipants img')).toHaveCount(0);
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleCount').fill('2');
  await expect(page.locator('#raffleSummary')).toContainText('2 kişi dahil · 6 toplam hak');
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleEvent')).toBeDisabled();
  await expect(page.locator('#raffleStage')).toHaveClass(/is-drawing/);
  await page.waitForTimeout(1000);
  await expect(page.locator('#raffleResults li')).toHaveCount(0);
  await expect(page.locator('#raffleResults li')).toHaveCount(2, { timeout: 6500 });
  await expect(page.locator('#raffleResults')).not.toContainText('Bora');
  await expect(page.locator('#raffleHistory article')).toHaveCount(1);
  expect(state.requests[0].excluded).toEqual(['b']);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-delete-draw]').click();
  await expect(page.locator('#raffleHistory article')).toHaveCount(0);
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleResults li')).toHaveCount(2, { timeout: 6500 });
  expect(state.requests[1].requestId).not.toEqual(state.requests[0].requestId);
  expect(state.deletes).toHaveLength(1);
});
test('uncertain save retains same request and reduced-motion avoids rotating names', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await fixture(page, true);
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStatus')).toContainText('Sonuç kaydedilmiş olabilir');
  await expect(page.locator('#raffleEvent')).toBeDisabled();
  await expect(page.locator('#raffleStart')).toHaveText('Aynı çekiliş sonucunu yeniden sorgula');
  await page.locator('#raffleStart').click();
  await expect(page.locator('#raffleStageName')).toHaveText('Şanslı isimler seçiliyor…');
  await expect(page.locator('#raffleResults li')).toHaveCount(1, { timeout: 6500 });
  expect(state.requests[1]).toEqual(state.requests[0]);
  expect(state.draws).toHaveLength(1);
  await expect(page.locator('#raffleEvent')).toBeEnabled();
});
test('mobile panel supports search, reinclusion, empty event and history reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.locator('#raffleSearch').fill('bora');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(1);
  await page.locator('[data-person=b]').uncheck();
  await page.locator('#raffleIncludeAll').click();
  await expect(page.locator('[data-person=b]')).toBeChecked();
  await page.locator('#raffleSearch').fill('');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: '/workspace/.onboarding-runtime/raffles-mobile.png', fullPage: true });
  await page.locator('#raffleEvent').selectOption('two');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(0);
  await expect(page.locator('#raffleStart')).toBeDisabled();
  await page.locator('#raffleEvent').selectOption('one');
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
  await page.locator('#raffleRefresh').click();
  await expect(page.locator('#raffleParticipants input')).toHaveCount(3);
});
