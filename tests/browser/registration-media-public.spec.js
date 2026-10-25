import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64');
const image = name => `https://res.cloudinary.com/w2trki15/image/upload/v1/${name}.png`;
const reference = 'photo-registration-reference';
const event = { id: 'media-form', title: 'Fotoğraflı etkinlik', date: '2026-10-14', time: '18:00', location: 'Kayseri', images: [], published: true, registrationMode: 'native', registrationEnabled: true };
const core = [
  { id: 'full_name', type: 'text', label: 'Ad soyad', required: true },
  { id: 'class_year', type: 'select', label: 'Sınıf', required: true, options: ['1. Sınıf', '2. Sınıf'] },
  { id: 'phone', type: 'tel', label: 'Telefon', required: true },
];
const photoField = (required = true) => ({ id: 'project_photo', type: 'photo', label: 'Çalışmanın fotoğrafı', required });

async function fixture(page, { fields = [photoField()], receipt = false, failures = [] } = {}) {
  const state = { fields, posts: [], failures: [...failures], formFailures: [], otherRequests: [], holdSubmission: null };
  await page.clock.install({ time: new Date('2026-10-13T10:00:00+03:00') });
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.createdMediaURLs = [];
    window.revokedMediaURLs = [];
    URL.createObjectURL = blob => {
      const url = create(blob);
      window.createdMediaURLs.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      window.revokedMediaURLs.push(url);
      revoke(url);
    };
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('https://res.cloudinary.com/w2trki15/image/upload/**', route => route.request().url().includes('broken')
    ? route.abort() : route.fulfill({ contentType: 'image/png', body: photo }));
  await page.route('**/api/**', route => {
    state.otherRequests.push(route.request().url());
    return route.fulfill({ status: 501, json: { error: 'Unmocked media-test API' } });
  });
  await page.route('**/api/events*', route => route.fulfill({ json: { events: [event] } }));
  await page.route('**/api/registrations*', async route => {
    const request = route.request(), url = new URL(request.url()), action = url.searchParams.get('action');
    if (action === 'form') {
      if (state.formFailures.length) return route.fulfill({ status: 503, json: { error: state.formFailures.shift() } });
      return route.fulfill({ json: { available: true, form: { enabled: true, description: `Form açıklaması: ${url.searchParams.get('event_id')}`, fields: [...core, ...state.fields], receipt: { enabled: receipt, required: false } } } });
    }
    if (action === 'submit') {
      const data = await new Request('http://fixture.test', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
      const files = {};
      for (const [name, file] of data) {
        if (typeof file !== 'string') files[name] = { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
      }
      state.posts.push({ eventId: url.searchParams.get('event_id'), requestId: data.get('requestId'), answers: JSON.parse(data.get('answers')), files });
      if (state.holdSubmission) await state.holdSubmission;
      if (state.failures.length) return route.fulfill({ status: state.failures.shift(), json: { error: 'Dosya alınamadı. Tekrar deneyebilirsin.' } });
      return route.fulfill({ json: { ok: true, reference, event } });
    }
    state.otherRequests.push(request.url());
    return route.fulfill({ status: 501, json: { error: 'Unmocked media-test action' } });
  });
  return state;
}

async function open(page) {
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator('#nativeRegistrationForm')).toBeVisible();
}

async function fillCore(page) {
  await page.locator('#registration-full_name').fill('Özel fotoğraf katılımcısı');
  await page.locator('#registration-class_year').selectOption('2. Sınıf');
  await page.locator('#registration-phone').fill('05551234567');
}

test('legacy text choices remain native and keep their original string and array answers', async ({ page }) => {
  const state = await fixture(page, { fields: [
    { id: 'session', type: 'select', label: 'Oturum', required: true, options: ['Sabah', 'Akşam'] },
    { id: 'meal', type: 'radio', label: 'Yemek', required: true, options: ['Standart', 'Vejetaryen'] },
    { id: 'topics', type: 'checkboxes', label: 'Konular', required: false, options: ['Bilim', 'Sanat'] },
  ] });
  await open(page);
  await fillCore(page);
  await expect(page.locator('select#registration-session')).toBeVisible();
  await expect(page.locator('.registration-image-choices')).toHaveCount(0);
  await page.locator('#registration-session').selectOption('Akşam');
  await page.locator('#registration-meal-1').check();
  await page.locator('#registration-topics-0').check();
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts[0].answers).toMatchObject({ session: 'Akşam', meal: 'Vejetaryen', topics: ['Bilim'] });
  expect(state.posts[0].files).toEqual({});
});

test('image dropdown, single and multiple choices show editable labels and work with keyboard and broken images', async ({ page }) => {
  const state = await fixture(page, { fields: [
    { id: 'session', type: 'select', label: 'Oturum', required: true, options: ['Yeni isim 1', 'Yeni isim 2'], optionImages: [image('first'), image('broken')] },
    { id: 'meal', type: 'radio', label: 'Yemek', required: true, options: ['Standart', 'Vejetaryen'], optionImages: [image('meal'), ''] },
    { id: 'topics', type: 'checkboxes', label: 'Konular', required: true, options: ['Bilim', 'Sanat'], optionImages: [image('science'), image('art')] },
  ] });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await fillCore(page);
  await expect(page.locator('select#registration-session')).toHaveCount(0);
  await expect(page.locator('#registration-field-session .registration-choice-media img').first()).toHaveAttribute('alt', 'Yeni isim 1 görseli');
  await expect(page.locator('#registration-field-session')).toContainText('Görsel yüklenemedi');
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registration-error-session')).toHaveText('Bu alanı doldurmalısın.');
  await expect(page.getByRole('radio', { name: 'Yeni isim 1', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Yeni isim 2', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Vejetaryen', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Bilim', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Sanat', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].answers).toMatchObject({ session: 'Yeni isim 2', meal: 'Vejetaryen', topics: ['Bilim', 'Sanat'] });
});

test('an optional photo may be omitted without adding a private filename or an empty photo answer', async ({ page }) => {
  const state = await fixture(page, { fields: [photoField(false)] });
  await open(page);
  await fillCore(page);
  await expect(page.locator('#registrationUploadBudget')).toContainText('toplam dosya sınırı 4 MB');
  await expect(page.locator('#registration-field-project_photo .registration-photo-preview')).toBeHidden();
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts[0].answers).not.toHaveProperty('project_photo');
  expect(state.posts[0].files).toEqual({});
});

test('an optional image dropdown can return to an empty selection', async ({ page }) => {
  const state = await fixture(page, { fields: [{ id: 'style', type: 'select', label: 'Stil', required: false, options: ['Bir', 'İki'], optionImages: [image('one'), ''] }] });
  await open(page);
  await fillCore(page);
  await page.getByRole('radio', { name: 'Bir', exact: true }).check();
  await page.getByRole('button', { name: 'Stil: seçimi temizle', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Bir', exact: true })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'İki', exact: true })).not.toBeChecked();
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts[0].answers.style).toBe('');
});

test('a required photo has a separate error and uploads the original file outside answers and saved summary', async ({ page }) => {
  const state = await fixture(page, { receipt: true });
  await open(page);
  await fillCore(page);
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registration-error-project_photo')).toHaveText('Bu alan için bir fotoğraf yüklemelisin.');
  await expect(page.locator('#registration-project_photo')).toBeFocused();
  expect(state.posts).toHaveLength(0);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'ozel-calisma.jpg', mimeType: 'image/jpg', buffer: photo });
  await expect(page.locator('.registration-photo-preview img')).toHaveAttribute('src', /^blob:/);
  const previewUrl = await page.locator('.registration-photo-preview img').getAttribute('src');
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts[0].answers).not.toHaveProperty('project_photo');
  expect(state.posts[0].files['photo:project_photo']).toEqual({ name: 'ozel-calisma.jpg', type: 'image/jpg', bytes: photo });
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(previewUrl);
  await expect(page.locator('#registrationSuccess')).not.toContainText(/ozel-calisma|ozel-dekont|05551234567|Özel fotoğraf/);
  const downloading = page.waitForEvent('download');
  await page.locator('#registrationDownloadSummary').click();
  const saved = readFileSync(await (await downloading).path(), 'utf8');
  expect(saved).toContain(reference);
  expect(saved).not.toMatch(/ozel-calisma|ozel-dekont|05551234567|Özel fotoğraf|blob:|data:image/);
  expect(state.otherRequests).toEqual([]);
});

test('SVG and oversized photos are rejected before upload while original form answers remain editable', async ({ page }) => {
  const state = await fixture(page);
  await open(page);
  await fillCore(page);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registration-error-project_photo')).toHaveText('Fotoğraf için JPG, PNG veya WebP dosyası seç.');
  await expect(page.locator('.registration-photo-preview img')).toBeHidden();
  await page.locator('#registration-project_photo').setInputFiles({ name: 'buyuk.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registration-error-project_photo')).toHaveText('Dosya en fazla 4 MB olabilir.');
  await expect(page.locator('#registration-full_name')).toHaveValue('Özel fotoğraf katılımcısı');
  expect(state.posts).toHaveLength(0);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.png', mimeType: 'application/octet-stream', buffer: photo });
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].files['photo:project_photo'].bytes).toEqual(photo);
});

test('multiple photo questions share one 4 MB budget before the API request', async ({ page }) => {
  const state = await fixture(page, { fields: [photoField(), { id: 'extra_photo', type: 'photo', label: 'İkinci fotoğraf', required: false }] });
  await open(page);
  await fillCore(page);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.png', mimeType: 'image/png', buffer: Buffer.alloc(3 * 1024 * 1024) });
  await page.locator('#registration-extra_photo').setInputFiles({ name: 'ikinci.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024) });
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registration-error-project_photo')).toContainText('Fotoğraflar toplam en fazla 4 MB');
  expect(state.posts).toHaveLength(0);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.png', mimeType: 'image/png', buffer: photo });
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test('a rejected photo request keeps all files, choices and the same retry identity without claiming success', async ({ page }) => {
  const state = await fixture(page, { receipt: true, failures: [422], fields: [photoField(), { id: 'style', type: 'radio', label: 'Stil', required: true, options: ['Bir', 'İki'], optionImages: [image('one'), image('two')] }] });
  await open(page);
  await fillCore(page);
  await page.getByRole('radio', { name: 'İki', exact: true }).check();
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.png', mimeType: '', buffer: photo });
  const previewUrl = await page.locator('.registration-photo-preview img').getAttribute('src');
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationFeedback')).toContainText('Tekrar deneyebilirsin');
  await expect(page.locator('#registrationSuccess')).toHaveCount(0);
  await expect(page.locator('#registration-full_name')).toHaveValue('Özel fotoğraf katılımcısı');
  await expect(page.getByRole('radio', { name: 'İki', exact: true })).toBeChecked();
  expect(await page.locator('#registration-project_photo').evaluate(input => input.files[0].name)).toBe('calisma.png');
  expect(await page.evaluate(() => window.revokedMediaURLs)).not.toContain(previewUrl);
  await page.locator('#registrationSubmit').click();
  await expect(page.locator('#registrationSuccess')).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual(state.posts[0]);
});

test('replacing, removing, resetting and switching a form revoke its local photo previews', async ({ page }) => {
  await fixture(page);
  await open(page);
  const input = page.locator('#registration-project_photo');
  const choose = name => input.setInputFiles({ name, mimeType: 'image/png', buffer: photo });
  await choose('first.png');
  const first = await page.locator('.registration-photo-preview img').getAttribute('src');
  await choose('second.png');
  const second = await page.locator('.registration-photo-preview img').getAttribute('src');
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(first);
  await page.getByRole('button', { name: 'Çalışmanın fotoğrafı: seçilen fotoğrafı kaldır', exact: true }).click();
  expect(await input.evaluate(element => element.files.length)).toBe(0);
  await expect(page.locator('.registration-photo-preview')).toBeHidden();
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(second);
  await choose('third.png');
  const third = await page.locator('.registration-photo-preview img').getAttribute('src');
  await page.locator('#nativeRegistrationForm').evaluate(form => form.reset());
  await expect(page.locator('.registration-photo-preview')).toBeHidden();
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(third);
  await choose('fourth.png');
  const fourth = await page.locator('.registration-photo-preview img').getAttribute('src');
  await page.evaluate(() => window.ercupsaRegistration.mount({ event: { id: 'next-media', title: 'Başka etkinlik' }, container: document.getElementById('nativeFormWrap') }));
  await expect(page.locator('#registrationDescription')).toContainText('next-media');
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(fourth);
});

test('a late submission cannot replace another event form and photo removal is disabled while sending', async ({ page }) => {
  const state = await fixture(page);
  let release;
  state.holdSubmission = new Promise(resolve => { release = resolve; });
  await open(page);
  await fillCore(page);
  await page.locator('#registration-project_photo').setInputFiles({ name: 'calisma.png', mimeType: 'image/png', buffer: photo });
  const preview = await page.locator('.registration-photo-preview img').getAttribute('src');
  await page.locator('#registrationSubmit').click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.locator('.registration-photo-remove')).toBeDisabled();
  await page.evaluate(() => window.ercupsaRegistration.mount({ event: { id: 'next-media', title: 'Başka etkinlik' }, container: document.getElementById('nativeFormWrap') }));
  await expect(page.locator('#registrationDescription')).toContainText('next-media');
  release();
  await page.waitForResponse(response => response.url().includes('action=submit'));
  await expect(page.locator('#registrationDescription')).toContainText('next-media');
  await expect(page.locator('#registrationSuccess')).toHaveCount(0);
  expect(await page.evaluate(() => window.revokedMediaURLs)).toContain(preview);
});

test('unsafe option images and load errors offer retry instead of creating an incomplete form', async ({ page }) => {
  const state = await fixture(page, { fields: [{ id: 'style', type: 'radio', label: 'Stil', required: false, options: ['Bir'], optionImages: ['https://example.com/unsafe.png'] }] });
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator('#registrationFeedback')).toHaveText('Form bilgileri geçersiz.');
  await expect(page.locator('#nativeRegistrationForm')).toHaveCount(0);
  state.fields = [photoField(false)];
  state.formFailures.push('Form şu anda yüklenemedi.');
  await page.locator('#nativeFormRetry').click();
  await expect(page.locator('#registrationFeedback')).toHaveText('Form şu anda yüklenemedi.');
  await page.locator('#nativeFormRetry').click();
  await expect(page.locator('#nativeRegistrationForm')).toBeVisible();
  expect(state.posts).toHaveLength(0);
});
