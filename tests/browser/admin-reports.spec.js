import { test, expect } from '@playwright/test';
import { mockOwnerSession, ownerFixtureSession } from './admin-session-fixture.js';

const summary = { eventCount: 2, applications: 5, main: 3, waitlisted: 1, cancelled: 1, entered: 2, qrEntered: 1, manualEntered: 1, noShows: null,
  coverage: { eventsWithEntryData: 1, eventsWithRegistrationData: 2, completeEvents: 0, totalEvents: 2 } };
async function fixture(page, { permissions, width = 1280, auditRows } = {}) {
  const state = { statistics: [], audit: [], mutations: [], hold: null };
  await page.setViewportSize({ width, height: 900 });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 501, json: { error: 'Unmocked reports fixture' } }));
  await mockOwnerSession(page, permissions ? { state, onSession: route => route.fulfill({ json: { session: { ...ownerFixtureSession, id: 'reader', role: 'admin', permissions } } }) } : { state });
  await page.route('**/api/events*', route => route.fulfill({ json: { events: [] } }));
  await page.route('**/api/community*', route => route.fulfill({ json: { batches: [] } }));
  await page.route('**/api/statistics*', async route => {
    const request = route.request();
    if (request.method() === 'POST') { state.mutations.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    state.statistics.push(new URL(request.url()).search);
    if (state.hold) await state.hold;
    return route.fulfill({ json: { asOf: '2026-10-25T12:00:00Z', summary, catalog: [{ id: 'one', title: 'Konferans', date: '2026-10-22' }, { id: 'two', title: 'Atölye', date: '2026-10-24' }], events: [
      { id: 'one', title: 'Konferans <img src=x onerror=window.injected=true>', date: '2026-10-22', applications: 4, main: 2, waitlisted: 1, cancelled: 1, entered: 2, qrEntered: 1, manualEntered: 1, noShows: null, capacity: 4, occupancy: 50, trackingComplete: false, trackingRevision: '' },
      { id: 'two', title: 'Atölye', date: '2026-10-24', applications: 1, main: 1, waitlisted: 0, cancelled: 0, entered: null, qrEntered: null, manualEntered: null, noShows: null, capacity: null, occupancy: null, trackingComplete: false, trackingRevision: '' },
    ] } });
  });
  await page.route('**/api/event-audit*', route => {
    const query = new URL(route.request().url()).searchParams; state.audit.push(Object.fromEntries(query));
    return route.fulfill({ json: { total: 51, page: Number(query.get('page') || 1), totalPages: 2,
      events: [{ id: 'one', title: 'Konferans <img src=x onerror=window.injected=true>' }], types: auditRows ? auditRows.map(item => item.type) : ['registration.promote', 'update'],
      operations: auditRows || [{ id: 'operation-one', eventId: 'one', type: 'registration.promote', at: '2026-10-24T21:30:00Z', actor: { id: 'delegate', username: 'editor-one' }, before: { status: 'waitlisted' }, after: { status: 'main' } }] } });
  });
  await page.goto('/admin.html'); await expect(page.locator('#app')).toBeVisible();
  return state;
}

test('statistics load on demand, show unknown attendance and filter real event dates safely', async ({ page }) => {
  const state = await fixture(page, { width: 390 });
  expect(state.statistics).toEqual([]); expect(state.audit).toEqual([]);
  await page.locator('[data-tab="statistics"]').click();
  await expect(page.locator('#statisticsCards .statistics-card')).toHaveCount(8);
  await expect(page.locator('#statisticsRows tr')).toHaveCount(2);
  await expect(page.locator('#statisticsRows')).toContainText('Sınırsız');
  await expect(page.locator('#statisticsRows')).toContainText('—');
  await expect(page.locator('#statisticsRows img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('#statisticsStatus')).toContainText('Giriş verisi 1/2');
  await page.locator('#statisticsEvent').selectOption('one');
  await page.locator('#statisticsFrom').fill('2026-10-01');
  await page.locator('#statisticsTo').fill('2026-10-31');
  await page.locator('#statisticsRefresh').click();
  await expect.poll(() => state.statistics.length).toBe(2);
  const query = new URLSearchParams(state.statistics.at(-1));
  expect(Object.fromEntries(query)).toEqual({ eventId: 'one', from: '2026-10-01', to: '2026-10-31' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('attendance completion asks for confirmation and sends the optimistic revision', async ({ page }) => {
  const state = await fixture(page); await page.locator('[data-tab="statistics"]').click();
  await expect(page.locator('[data-complete-event="one"]')).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-complete-event="one"]').click();
  expect(state.mutations).toEqual([]);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-complete-event="one"]').click();
  await expect.poll(() => state.mutations.length).toBe(1);
  expect(state.mutations[0]).toEqual({ eventId: 'one', trackingComplete: true, expectedRevision: '' });
});

test('event audit renders safe actor history and supports event/type/date pagination', async ({ page }) => {
  const state = await fixture(page, { width: 390 });
  await page.locator('[data-tab="audit"]').click();
  await expect(page.locator('#auditOperations')).toContainText('Yedek asıl listeye alındı');
  await expect(page.locator('#auditOperations')).toContainText('@editor-one');
  await expect(page.locator('#auditOperations')).toContainText('25.10.2026');
  await expect(page.locator('#auditOperations img')).toHaveCount(0);
  await page.locator('#auditEvent').selectOption('one'); await page.locator('#auditType').selectOption('registration.promote');
  await page.locator('#auditFrom').fill('2026-10-25'); await page.locator('#auditTo').fill('2026-10-25');
  await page.locator('#auditRefresh').click(); await expect.poll(() => state.audit.length).toBe(2);
  await page.locator('#auditNext').click(); await expect(page.locator('#auditPage')).toHaveText('2 / 2');
  expect(state.audit.at(-1)).toEqual({ eventId: 'one', type: 'registration.promote', from: '2026-10-25', to: '2026-10-25', page: '2' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('report-only delegates see no entrance mutations or unrelated admin sections', async ({ page }) => {
  const state = await fixture(page, { permissions: ['statistics.view'] });
  await expect(page.locator('[data-tab="statistics"]')).toBeVisible();
  await expect(page.locator('#statisticsRows tr')).toHaveCount(2);
  await expect(page.locator('[data-complete-event]')).toHaveCount(0);
  await expect(page.locator('[data-tab="audit"]')).toBeHidden();
  await expect(page.locator('[data-tab="registrations"]')).toBeHidden();
  expect(state.audit).toEqual([]); expect(state.mutations).toEqual([]);
});


test('audit setting changes and payment reviews use readable Turkish labels', async ({ page }) => {
  const records = [
    { id: 'capacity-one', eventId: 'one', type: 'capacity.change', at: '2026-10-24T21:30:00Z', before: { maxRegistrations: 20 }, after: { maxRegistrations: 30 } },
    { id: 'payment-one', eventId: 'one', type: 'payment.review', at: '2026-10-24T21:30:00Z', before: { reviewStatus: 'pending' }, after: { reviewStatus: 'approved' } },
    { id: 'deleted-one', eventId: 'one', type: 'registration.delete', at: '2026-10-24T21:30:00Z', before: { status: 'main' } },
  ];
  await fixture(page, { auditRows: records });
  await page.locator('[data-tab="audit"]').click();
  await expect(page.locator('#auditOperations')).toContainText('Asıl kontenjan değişti');
  await expect(page.locator('#auditOperations')).toContainText('Asıl kontenjan: 20');
  await expect(page.locator('#auditOperations')).toContainText('Asıl kontenjan: 30');
  await expect(page.locator('#auditOperations')).toContainText('Ödeme kontrolü güncellendi');
  await expect(page.locator('#auditOperations')).toContainText('Ödeme durumu: Onaylandı');
  await expect(page.locator('#auditOperations')).toContainText('Kayıt silindi');
  await expect(page.locator('#auditType option[value="capacity.change"]')).toHaveText('Asıl kontenjan değişti');
});
