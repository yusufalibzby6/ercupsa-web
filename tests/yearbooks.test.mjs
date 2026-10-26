import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createYearbooksHandler } from '../netlify/functions/yearbooks.mjs';
import { defaultYearbookDraft, normalizeYearbookDraft, yearbookId, yearbookPhoto, YEARBOOK_STORE, yearbookKey } from '../netlify/lib/yearbooks.mjs';
import { adminLogin, signedAdminCookie } from '../netlify/lib/security.mjs';
import { ADMIN_ACCOUNTS_KEY, ADMIN_STORE, normalizedPermissions } from '../netlify/lib/admin-auth.mjs';
import { renderYearbook, renderYearbookArchive, yearbookDocument } from '../assets/yearbook-render.js';

const prior = { password: process.env.ADMIN_PASSWORD, username: process.env.ADMIN_USERNAME };
process.env.ADMIN_PASSWORD = 'synthetic-yearbook-owner-password'; delete process.env.ADMIN_USERNAME;
after(() => { for (const [key, value] of [['ADMIN_PASSWORD', prior.password], ['ADMIN_USERNAME', prior.username]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const origin = 'https://site.test', photo = 'https://res.cloudinary.com/demo/image/upload/v1/photo.jpg';
const owner = () => adminLogin(new Request(origin, { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
function memory() {
  const values = new Map(), writes = []; let sequence = 0;
  return { values, writes, beforeSet: null,
    async get(key) { return structuredClone(values.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(values.get(key) || null); },
    async list({ prefix }) { return { blobs: [...values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async setJSON(key, data, options = {}) { await this.beforeSet?.(key, data); const existing = values.get(key); if (options.onlyIfNew && existing || options.onlyIfMatch && options.onlyIfMatch !== existing?.etag) return { modified: false }; writes.push(key); values.set(key, { data: structuredClone(data), etag: String(++sequence) }); return { modified: true }; },
  };
}
function fixture() {
  const store = memory(), adminStore = memory(); let sequence = 0;
  const state = { events: [{ id: 'event-one', title: 'Bilim buluşması', date: '2026-10-20', time: '15:30', category: 'Konferans', location: 'Fakülte', poster: photo, images: [{ url: photo, width: 1200, height: 900 }] }], eventReads: 0, statisticReads: 0, applications: 4, now: new Date('2026-10-25T12:00:00Z') };
  const stats = ids => ({ eventCount: ids.length, applications: state.applications, main: state.applications, waitlisted: 0, cancelled: 0, entered: null, qrEntered: null, manualEntered: null, asOf: state.now.toISOString(), coverage: { eventsWithEntryData: 0, totalEvents: ids.length, completeEvents: 0 } });
  const handler = createYearbooksHandler({ getStore(name) { assert.equal(name, YEARBOOK_STORE); return store; }, adminStore(name) { assert.equal(name, ADMIN_STORE); return adminStore; },
    readEvents: async () => { state.eventReads++; return structuredClone(state.events); }, statistics: async ids => { state.statisticReads++; return stats(ids); }, now: () => state.now, revision: () => `revision-${++sequence}` });
  const request = async (method = 'GET', query = '', input, cookie = '', headers = {}) => handler(new Request(origin + '/api/yearbooks' + query, { method, headers: { Origin: origin, Cookie: cookie, ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) }));
  const create = async (period = '2026-2027') => { const response = await request('POST', '', { period }, owner()); assert.equal(response.status, 201); return (await response.json()).yearbook; };
  const save = async (record, changes = {}) => { const draft = { ...record.draft, events: [{ id: 'event-one', section: 'conference', message: 'Birlikte öğrendik.', photos: [{ url: photo, caption: 'Bilim buluşması', rightsApproved: true }] }], ...changes }; const response = await request('PUT', '', { id: record.id, revision: record.revision, draft }, owner()); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).yearbook; };
  const publish = record => request('POST', '?action=publish', { id: record.id, revision: record.revision }, owner());
  const delegate = async permissions => { const account = { id: 'editor', username: 'editor', name: 'Yıllık editörü', role: 'admin', active: true, version: 'version-one', permissions: normalizedPermissions(permissions), salt: '0'.repeat(32), passwordHash: 'a'.repeat(64) }; await adminStore.setJSON(ADMIN_ACCOUNTS_KEY, { revision: 'accounts-one', accounts: [account] }); return signedAdminCookie(new Request(origin), account).split(';')[0]; };
  return { state, store, request, create, save, publish, delegate };
}

test('yearbook periods, photos and drafts reject invalid or unsafe inputs', () => {
  assert.equal(yearbookId('2026-2027'), '2026-2027');
  for (const id of ['2026-2028','2026–2027','../2026-2027',null]) assert.throws(() => yearbookId(id));
  for (const url of ['javascript:alert(1)','https://example.test/image/upload/photo.jpg','https://res.cloudinary.com/demo/image/upload/a.svg','https://res.cloudinary.com/demo/image/upload/f_svg/a','https://res.cloudinary.com/demo/image/upload/photo.jpg?token=x','https://a@res.cloudinary.com/demo/image/upload/photo.jpg']) assert.throws(() => yearbookPhoto(url));
  assert.equal(yearbookPhoto(photo), photo);
  const draft = defaultYearbookDraft(); assert.equal(draft.startDate, '2026-09-01'); assert.deepEqual(draft.events, []);
  for (const changes of [{ endDate: '2026-02-30' },{ startDate:'2027-12-01' },{ events:[{id:'one',section:'social',photos:[]},{id:'one',section:'social',photos:[]}] },{ boardPhoto:{url:photo,rightsApproved:'yes'} }]) assert.throws(() => normalizeYearbookDraft({ ...draft, ...changes }));
});

test('creating the first yearbook stores a private draft only and exposes no public catalog data', async () => {
  const f = fixture(), record = await f.create();
  assert.equal(record.visibility, 'draft'); assert.equal(record.publishedSnapshot, null);
  assert.deepEqual(await (await f.request()).json(), { yearbooks: [] });
  const before = [f.state.eventReads, f.state.statisticReads];
  assert.equal((await f.request('GET', '?id=2026-2027')).status, 404);
  assert.equal((await f.request('GET', '?action=readable&id=2026-2027')).status, 404);
  assert.deepEqual([f.state.eventReads, f.state.statisticReads], before);
  assert.equal((await f.request('POST', '', { period:record.period }, owner())).status, 409);
  assert.equal(f.store.values.size, 1);
});

test('draft, preview, editing and publication APIs check distinct permissions before reading yearbook data', async () => {
  const f = fixture(), record = await f.create();
  for (const query of ['?action=admin','?action=preview&id=2026-2027']) assert.equal((await f.request('GET', query)).status, 401);
  const none = await f.delegate(['events.manage']);
  assert.equal((await f.request('GET', '?action=admin', undefined, none)).status, 403);
  const viewer = await f.delegate(['yearbooks.view']);
  assert.equal((await f.request('GET', '?action=admin&id=2026-2027', undefined, viewer)).status, 200);
  assert.equal((await f.request('PUT', '', {id:record.id,revision:record.revision,draft:record.draft}, viewer)).status, 403);
  assert.equal((await f.request('POST', '?action=publish', {id:record.id,revision:record.revision}, viewer)).status, 403);
  const manager = await f.delegate(['yearbooks.manage']);
  assert.equal((await f.request('POST', '?action=publish', {id:record.id,revision:record.revision}, manager)).status, 403);
  const publisher = await f.delegate(['yearbooks.publish']);
  assert.equal((await f.request('PUT', '', {id:record.id,revision:record.revision,draft:record.draft}, publisher)).status, 403);
});

test('admin catalog projects only event media, never registration or ticket information', async () => {
  const f = fixture(); f.state.events[0].privateNote = 'private-ticket-value';
  const response = await f.request('GET','?action=admin',undefined,owner()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.events.length, 1);
  assert.equal(JSON.stringify(data).includes('private-ticket-value'), false);
  assert.deepEqual(Object.keys(data.events[0]).sort(), ['category','date','id','images','poster','title']);
});

test('previews are authenticated, noncacheable and do not publish or create snapshots', async () => {
  const f = fixture(), record = await f.save(await f.create());
  const before = structuredClone(f.store.values.get(yearbookKey(record.id)));
  const preview = await f.request('GET', '?action=preview&id=2026-2027', undefined, owner()), data = await preview.json();
  assert.equal(preview.status,200); assert.equal(preview.headers.get('Cache-Control'),'private, no-store'); assert.match(preview.headers.get('X-Robots-Tag'),/noindex/);
  assert.equal(data.preview,true); assert.equal(data.yearbook.statistics.entered,null); assert.equal(data.yearbook.events[0].photos[0].url,photo);
  assert.deepEqual(f.store.values.get(yearbookKey(record.id)),before);
  assert.equal((await f.request('GET','?id=2026-2027')).status,404);
});

test('publication validates photo rights, known media, period and completed event dates', async () => {
  for (const change of ['no-rights','unknown-photo','outside-period','future','no-events','board-rights']) {
    const f = fixture(); let record = await f.create();
    const changes = {};
    if(change==='outside-period') changes.startDate='2026-11-01';
    if(change==='no-events') changes.events=[];
    if(change==='board-rights') changes.boardPhoto={url:photo,caption:'Ekibimiz',rightsApproved:false};
    record=await f.save(record,changes);
    if(change==='no-rights'||change==='unknown-photo') { const draft=structuredClone(record.draft); if(change==='no-rights') draft.events[0].photos[0].rightsApproved=false; else draft.events[0].photos[0].url=photo.replace('photo.jpg','unknown.jpg'); const result=await f.request('PUT','',{id:record.id,revision:record.revision,draft},owner()); record=(await result.json()).yearbook; }
    if(change==='future') f.state.events[0].date='2026-11-01';
    assert.equal((await f.publish(record)).status,400,change);
    assert.equal((await f.request('GET','?id=2026-2027')).status,404,change);
  }
});

test('publication compares same-day event start times in Turkey and waits on unknown times', async () => {
  for (const [time, expected] of [['16:00', 400], ['14:00', 200], ['', 400]]) {
    const f = fixture();
    // The fixture instant is 15:00 in Turkey.
    f.state.events[0].date = '2026-10-25';
    f.state.events[0].time = time;
    const record = await f.save(await f.create());
    assert.equal((await f.publish(record)).status, expected, time || 'unknown start time');
  }
  const f = fixture(); f.state.events[0].time = '';
  assert.equal((await f.publish(await f.save(await f.create()))).status, 200, 'a past event date needs no invented start time');
});

test('published content and statistics stay frozen after live event and registration changes', async () => {
  const f = fixture(), record = await f.save(await f.create());
  assert.equal((await f.publish(record)).status,200);
  const initial = await (await f.request('GET','?id=2026-2027')).json();
  assert.equal(initial.yearbook.statistics.applications,4);
  assert.equal(initial.yearbook.statistics.entered,null);
  f.state.events[0].title='Changed live event'; f.state.events[0].images=[]; f.state.applications=800;
  const reads=[f.state.eventReads,f.state.statisticReads];
  assert.deepEqual(await (await f.request('GET','?id=2026-2027')).json(), initial);
  assert.deepEqual([f.state.eventReads,f.state.statisticReads], reads);
  const catalog=await (await f.request()).json(); assert.equal(catalog.yearbooks[0].id,'2026-2027'); assert.equal(JSON.stringify(catalog).includes('rightsReview'),false);
  const html=await f.request('GET','?action=readable&id=2026-2027'); assert.match(html.headers.get('content-type'),/text\/html/); assert.match(await html.text(),/Bilim buluşması/);
});

test('saving a published draft does not change the public edition until explicitly republished', async () => {
  const f=fixture(); let record=await f.save(await f.create()); record=(await (await f.publish(record)).json()).yearbook;
  const first=await (await f.request('GET','?id=2026-2027')).json();
  record=await f.save(record,{title:'New draft title'});
  assert.deepEqual(await (await f.request('GET','?id=2026-2027')).json(),first);
  record=(await (await f.publish(record)).json()).yearbook;
  assert.equal(record.publicationRevision,2); assert.equal((await (await f.request('GET','?id=2026-2027')).json()).yearbook.title,'New draft title');
  const result=await f.request('POST','?action=unpublish',{id:record.id,revision:record.revision},owner()); assert.equal(result.status,200);
  const stored=f.store.values.get(yearbookKey(record.id)).data; assert.equal(stored.draft.title,'New draft title'); assert.ok(stored.publishedSnapshot); assert.equal((await f.request('GET','?id=2026-2027')).status,404);
});

test('concurrent edits use revision and ETag guards, preserving exactly one winner', async () => {
  const f=fixture(), record=await f.create();
  const results=await Promise.all(['First title','Second title'].map(title=>f.request('PUT','',{id:record.id,revision:record.revision,draft:{...record.draft,title}},owner())));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const stored=f.store.values.get(yearbookKey(record.id)).data; assert.ok(['First title','Second title'].includes(stored.draft.title)); assert.equal(stored.operations.length,2);
});

test('publication never writes gallery/content stores and cross-origin mutations are rejected', async () => {
  const f=fixture(), record=await f.save(await f.create()); assert.equal((await f.publish(record)).status,200);
  assert.ok(f.store.writes.every(key=>key===yearbookKey(record.id)));
  assert.equal((await f.request('POST','',{period:'2027-2028'},owner(),{Origin:'https://other.test'})).status,403);
});

test('renderer escapes editorial content and labels missing statistics without invented numbers', async () => {
  const f=fixture(), record=await f.save(await f.create(),{title:'<script>alert(1)</script>',presidentMessage:'<img src=x onerror=alert(1)>'});
  const data=await (await f.request('GET','?action=preview&id=2026-2027',undefined,owner())).json();
  const html=renderYearbook(data.yearbook,{preview:true}); assert.equal(html.includes('<script>'),false); assert.match(html,/&lt;script&gt;/); assert.match(html,/Doğrulanmış veri bulunmuyor/); assert.match(html,/Yönetici önizlemesi/); assert.match(yearbookDocument(data.yearbook),/yearbook\.css/);
  assert.match(renderYearbookArchive([]),/Hikâyemiz birikiyor/);
});

test('only the owner may delete a published yearbook; deletion removes public and draft content without touching gallery data', async () => {
  const f = fixture(); let record = await f.save(await f.create());
  record = (await (await f.publish(record)).json()).yearbook;
  const input = { id: record.id, revision: record.revision };
  const before = structuredClone(f.store.values.get(yearbookKey(record.id)));
  assert.equal((await f.request('DELETE', '', input)).status, 401);
  const editor = await f.delegate(['yearbooks.view', 'yearbooks.manage', 'yearbooks.publish']);
  assert.equal((await f.request('DELETE', '', input, editor)).status, 403);
  assert.equal((await f.request('DELETE', '', input, owner(), { Origin: 'https://other.test' })).status, 403);
  assert.equal((await f.request('DELETE', '', { ...input, revision: 'stale' }, owner())).status, 409);
  assert.deepEqual(f.store.values.get(yearbookKey(record.id)), before);
  const result = await f.request('DELETE', '', input, owner());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, id: record.id, deleted: true });
  const tombstone = f.store.values.get(yearbookKey(record.id)).data;
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.draft, undefined); assert.equal(tombstone.publishedSnapshot, undefined);
  assert.equal(tombstone.rightsReview, undefined);
  assert.equal(tombstone.operations.at(-1).type, 'delete');
  assert.deepEqual(await (await f.request()).json(), { yearbooks: [] });
  const admin = await (await f.request('GET', '?action=admin', undefined, owner())).json();
  assert.deepEqual(admin.catalog, []);
  for (const query of ['?id=2026-2027', '?action=readable&id=2026-2027', '?action=preview&id=2026-2027', '?action=admin&id=2026-2027']) {
    assert.equal((await f.request('GET', query, undefined, query.includes('action=preview') || query.includes('action=admin') ? owner() : '')).status, 404);
  }
  assert.ok(f.store.writes.every(key => key === yearbookKey(record.id)));
});

test('a deleted period can be recreated once and old editor revisions cannot change the replacement', async () => {
  const f = fixture(), original = await f.save(await f.create());
  assert.equal((await f.request('DELETE', '', { id: original.id, revision: original.revision }, owner())).status, 200);
  const responses = await Promise.all([1, 2].map(() => f.request('POST', '', { period: original.id }, owner())));
  assert.deepEqual(responses.map(result => result.status).sort(), [201, 409]);
  const replacement = (await (await f.request('GET', '?action=admin&id=2026-2027', undefined, owner())).json()).yearbook;
  assert.equal(replacement.visibility, 'draft'); assert.deepEqual(replacement.draft.events, []);
  assert.equal(replacement.publishedSnapshot, null);
  for (const [method, query, extra] of [['PUT', '', { draft: original.draft }], ['POST', '?action=publish', {}], ['DELETE', '', {}]]) {
    const response = await f.request(method, query, { id: original.id, revision: original.revision, ...extra }, owner());
    assert.equal(response.status, 409);
  }
  assert.equal(f.store.values.get(yearbookKey(original.id)).data.revision, replacement.revision);
});

test('publication in flight cannot restore a yearbook deleted after its snapshot was read', async () => {
  const f = fixture(), record = await f.save(await f.create());
  const key = yearbookKey(record.id), input = { id: record.id, revision: record.revision };
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  f.store.beforeSet = async (writtenKey, value) => { if (writtenKey === key && value.visibility === 'published') { reached(); await gate; } };
  const publishing = f.publish(record);
  await entered;
  assert.equal((await f.request('DELETE', '', input, owner())).status, 200);
  release();
  assert.equal((await publishing).status, 404);
  assert.equal(f.store.values.get(key).data.deleted, true);
  assert.deepEqual(await (await f.request()).json(), { yearbooks: [] });
});

test('a concurrent edit prevents a pending deletion from erasing the newly saved draft', async () => {
  const f = fixture(), record = await f.save(await f.create()), key = yearbookKey(record.id);
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  f.store.beforeSet = async (writtenKey, value) => { if (writtenKey === key && value.deleted) { reached(); await gate; } };
  const deleting = f.request('DELETE', '', { id: record.id, revision: record.revision }, owner());
  await entered;
  const draft = { ...record.draft, title: 'Son kaydedilen yıllık başlığı' };
  assert.equal((await f.request('PUT', '', { id: record.id, revision: record.revision, draft }, owner())).status, 200);
  release();
  assert.equal((await deleting).status, 409);
  assert.equal(f.store.values.get(key).data.draft.title, draft.title);
  assert.equal(f.store.values.get(key).data.deleted, undefined);
});
