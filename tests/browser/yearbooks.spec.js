import { test, expect } from '@playwright/test';
import { mockOwnerSession, ownerFixtureSession } from './admin-session-fixture.js';
import { yearbookDocument } from '../../assets/yearbook-render.js';

const image = 'https://res.cloudinary.com/demo/image/upload/v1/yearbook.jpg';
const event = { id:'event-one',title:'Bilim buluşması',date:'2026-10-20',category:'Konferans',poster:image,images:[{url:image,width:1200,height:900}] };
const draft = () => ({title:'ERCUPSA 2026–2027',description:'Birlikte öğrendik.',startDate:'2026-09-01',endDate:'2027-06-30',events:[],boardPhoto:{url:'',caption:'Ekibimiz',rightsApproved:false},presidentName:'',presidentMessage:'',closingMessage:'Teşekkür ederiz.'});
function published() { return {id:'2026-2027',period:'2026-2027',...draft(),events:[{...event,time:'15:30',location:'Fakülte',section:'conference',message:'Birlikte öğreniyoruz.',photos:[{url:image,caption:'Bilim buluşması'}]}],boardPhoto:null,statistics:{eventCount:1,applications:20,main:20,waitlisted:0,cancelled:0,entered:null,qrEntered:null,manualEntered:null,asOf:'2027-06-30T12:00:00Z',coverage:{eventsWithEntryData:0,totalEvents:1,completeEvents:0}},publishedAt:'2027-06-30T12:00:00Z',publicationRevision:1}; }
async function adminFixture(page,{readonly=false,holdSave=false,publishedInitially=false,permissions=null,publishError='',withEvent=false,deleteError=''}={}) {
  const initialDraft=draft(); if(withEvent || publishedInitially) initialDraft.events=[{id:event.id,section:'conference',message:'',photos:[{url:image,caption:'',rightsApproved:true}]}];
  const state={record:{id:'2026-2027',period:'2026-2027',draft:initialDraft,visibility:publishedInitially?'published':'draft',publishedSnapshot:publishedInitially?published():null,revision:'r1'},writes:[],reads:0,publishError,deleteError};
  const gate=new Promise(resolve=>{state.release=resolve;});
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/**',route=>route.fulfill({status:501,json:{error:'Unmocked yearbook endpoint'}}));
  await mockOwnerSession(page);
  if(readonly || permissions) await page.route('**/api/admin-auth*',route=>route.fulfill({json:{session:{...ownerFixtureSession,id:'viewer',username:'viewer',role:'admin',permissions:permissions || ['yearbooks.view']}}}));
  await page.route('**/api/events*',route=>route.fulfill({json:{events:[]}}));
  await page.route('**/api/community*',route=>route.fulfill({json:{batches:[],submissions:[],members:[]}}));
  await page.route('**/api/yearbooks*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='GET') {
      state.reads++;
      if(url.searchParams.get('action')==='admin') return route.fulfill({json:{catalog:state.record?[{...state.record,title:state.record.draft.title}]:[],events:[event],...(url.searchParams.has('id')?{yearbook:state.record}:{})}});
      const publicBook=state.record?.visibility==='published'?state.record.publishedSnapshot:null;
      if(url.searchParams.has('id')) return route.fulfill(publicBook?{json:{yearbook:publicBook}}:{status:404,json:{error:'Yıllık henüz yayımlanmamış.'}});
      return route.fulfill({json:{yearbooks:publicBook?[{id:publicBook.id,period:publicBook.period,title:publicBook.title,description:publicBook.description,publishedAt:publicBook.publishedAt}]:[]}});
    }
    const input=req.postDataJSON();state.writes.push({method:req.method(),action:url.searchParams.get('action'),input});
    if(holdSave) await gate;
    if(req.method()==='PUT') state.record={...state.record,draft:input.draft,revision:'r2'};
    else if(url.searchParams.get('action')==='publish') {
      if(state.publishError) return route.fulfill({status:400,json:{error:state.publishError}});
      state.record={...state.record,visibility:'published',publishedSnapshot:{...published(),title:state.record.draft.title,description:state.record.draft.description},revision:'r3'};
    }
    else if(url.searchParams.get('action')==='unpublish') state.record={...state.record,visibility:'draft',revision:'r4'};
    else if(req.method()==='DELETE') { if(state.deleteError) return route.fulfill({status:409,json:{error:state.deleteError}}); state.record=null; return route.fulfill({json:{ok:true,id:input.id,deleted:true}}); }
    return route.fulfill({json:{ok:true,yearbook:state.record}});
  });
  await page.goto('/admin.html');await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-tab="yearbooks"]').click();
  await expect(page.locator('#yearbookSelect option')).toHaveCount(2);
  await page.locator('#yearbookSelect').selectOption('2026-2027');
  await expect(page.locator('[data-edit="title"]')).toHaveValue('ERCUPSA 2026–2027');
  return state;
}

test('admin selects existing photos, records media review and saves a draft before publishing',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const state=await adminFixture(page);
  await page.locator('[data-edit="title"]').fill('ERCUPSA: Birlikte bir yıl');
  await page.locator('#yearbookAddEvent').click();
  await expect(page.locator('[data-yearbook-event="event-one"]')).toBeVisible();
  await page.locator('[data-edit="section"]').selectOption('conference');
  await page.locator('[data-edit="message"]').fill('Bilim için bir aradaydık.');
  await page.locator('[data-edit="photoSelection"]').check();
  await expect(page.locator('[data-edit="photoRights"]')).not.toBeChecked();
  await page.locator('[data-edit="photoRights"]').check();
  await page.locator('[data-edit="photoCaption"]').fill('Etkinlikten bir an');
  await expect(page.locator('#yearbookPublish')).toBeDisabled();
  await page.locator('#yearbookSave').click();
  await expect(page.locator('#yearbookStatus')).toContainText('Taslak kaydedildi');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].input).toMatchObject({id:'2026-2027',revision:'r1',draft:{title:'ERCUPSA: Birlikte bir yıl',events:[{id:'event-one',section:'conference',message:'Bilim için bir aradaydık.',photos:[{url:image,caption:'Etkinlikten bir an',rightsApproved:true}]}]}});
  await expect(page.locator('#yearbookPreview')).toHaveAttribute('href','/yillik.html?donem=2026-2027&preview=1');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#yearbookPublish').click();
  await expect(page.locator('#yearbookStatus')).toContainText('Yıllık yayımlandı');
  await expect(page.locator('#yearbookActionStatus')).toContainText('Yıllık yayımlandı');
  await expect(page.locator('#yearbookPublicLink')).toBeVisible();
  await expect(page.locator('#yearbookPublicLink')).toHaveAttribute('href','/yillik/2026-2027');
  expect(state.writes[1]).toMatchObject({action:'publish',input:{id:'2026-2027',revision:'r2'}});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('yearbook read-only role can preview but cannot edit or publish',async({page})=>{
  const state=await adminFixture(page,{readonly:true});
  await expect(page.locator('[data-edit="title"]')).toBeDisabled();
  await expect(page.locator('#yearbookCreate')).toBeDisabled();
  await expect(page.locator('#yearbookSave')).toBeDisabled();
  await expect(page.locator('#yearbookPublish')).toBeDisabled();
  await expect(page.locator('#yearbookPreview')).toHaveAttribute('aria-disabled','false');
  await expect(page.locator('#yearbookDelete')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('publication errors are visible beside the button and do not falsely show a public link',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const error='Henüz gerçekleşmemiş etkinlikleri yayımlanan yıllığa ekleyemezsiniz.';
  await adminFixture(page,{withEvent:true,publishError:error});
  await expect(page.locator('#yearbookPublicLink')).toBeHidden();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#yearbookPublish').click();
  await expect(page.locator('#yearbookActionStatus')).toHaveAttribute('role','alert');
  await expect(page.locator('#yearbookActionStatus')).toContainText(error);
  await expect(page.locator('#yearbookActionStatus')).toBeInViewport();
  await expect(page.locator('#yearbookPublicLink')).toBeHidden();
  await expect(page.locator('#yearbookStatus')).not.toContainText('Yıllık yayımlandı');
  await expect(page.locator('[data-edit="title"]')).toHaveValue('ERCUPSA 2026–2027');
});

test('an owner can cancel deletion or retry after a conflict before removing a published yearbook',async({page})=>{
  const state=await adminFixture(page,{publishedInitially:true});
  await expect(page.locator('#yearbookPublicLink')).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#yearbookDelete').click();
  expect(state.writes).toHaveLength(0);
  state.deleteError='Yıllık başka bir pencerede değişti.';
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#yearbookDelete').click();
  await expect(page.locator('#yearbookActionStatus')).toContainText(state.deleteError);
  await expect(page.locator('#yearbookPublicLink')).toBeVisible();
  state.deleteError='';
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#yearbookDelete').click();
  await expect(page.locator('#yearbookEditorBody')).toBeHidden();
  await expect(page.locator('#yearbookSelect option')).toHaveCount(1);
  await expect(page.locator('#yearbookStatus')).toContainText('Yıllık silindi');
  expect(state.writes.at(-1)).toMatchObject({method:'DELETE',input:{id:'2026-2027',revision:'r1'}});
  await page.goto('/yillik.html?donem=2026-2027');
  await expect(page.locator('#yearbookContent')).toContainText('Yıllık şu anda açılamadı');
  await page.goto('/');
  await expect(page.locator('#homeYearbookAnnouncement')).toBeHidden();
});

test('an editor with manage and publish permissions still cannot delete a yearbook',async({page})=>{
  const state=await adminFixture(page,{publishedInitially:true,permissions:['yearbooks.view','yearbooks.manage','yearbooks.publish']});
  await expect(page.locator('#yearbookPublish')).toBeEnabled();
  await expect(page.locator('#yearbookDelete')).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('a successful publication appears on the homepage and the public archive',async({page})=>{
  const state=await adminFixture(page,{withEvent:true});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#yearbookPublish').click();
  await expect(page.locator('#yearbookPublicLink')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('#homeYearbookAnnouncement')).toBeVisible();
  await expect(page.locator('#homeYearbookTitle')).toHaveText(state.record.draft.title);
  await page.locator('#homeYearbookLink').click();
  await expect(page.locator('.yb-cover h1')).toHaveText(state.record.draft.title);
  await page.goto('/yilliklar.html');
  await expect(page.locator('.yb-archive-card h2')).toHaveText(state.record.draft.title);
});

test('logout clears private yearbook draft and suppresses a delayed save result',async({page})=>{
  const state=await adminFixture(page,{holdSave:true});await page.locator('[data-edit="title"]').fill('Private yearbook draft');await page.locator('#yearbookSave').click();await expect.poll(()=>state.writes.length).toBe(1);
  await page.evaluate(()=>document.dispatchEvent(new Event('admin-logout')));
  const finished=page.waitForResponse(response=>response.url().includes('/api/yearbooks')&&response.request().method()==='PUT');state.release();await finished;
  await expect(page.locator('#yearbookEditorBody')).toBeHidden();await expect(page.locator('#yearbookStatus')).toHaveText('');await expect(page.locator('#yearbookSelect option')).toHaveCount(1);
  expect(await page.locator('#yearbooksEditor').textContent()).not.toContain('Private yearbook draft');
});

test('public animated yearbook keeps real unknown statistics clear and fits mobile reduced-motion screens',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  await page.route('https://**/*',route=>route.abort());await page.route('**/api/yearbooks*',route=>route.fulfill({json:{yearbook:published()}}));
  await page.goto('/yillik.html?donem=2026-2027');
  await expect(page.locator('h1')).toHaveText('ERCUPSA 2026–2027');
  await expect(page.locator('.yb-stat').nth(2)).toContainText('Doğrulanmış veri bulunmuyor');
  await expect(page.locator('.yb-chapter-conference h3')).toHaveText('Bilim buluşması');
  await expect(page.locator('body')).not.toHaveClass(/yb-motion/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('unpublished yearbook links reveal no draft content to visitors',async({page})=>{
  await page.route('**/api/yearbooks*',route=>route.fulfill({status:404,json:{error:'Yıllık henüz yayımlanmamış.'}}));await page.goto('/yillik.html?donem=2026-2027');
  await expect(page.locator('#yearbookContent')).toContainText('Yıllık şu anda açılamadı');await expect(page.locator('.yb-cover')).toHaveCount(0);
});

test('server-rendered photos that fail before the enhancement module loads get a readable fallback',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/assets/yearbook.js*',async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.continue();});
  await page.route('**/yillik/2026-2027',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:yearbookDocument(published())}));
  await page.goto('/yillik/2026-2027');
  await expect(page.locator('.yb-cover .yb-photo-unavailable')).toContainText('Bu fotoğraf şu anda görüntülenemiyor.');
  await expect(page.locator('.yb-cover .yb-photo img')).toBeHidden();
  await expect(page.locator('h1')).toHaveText('ERCUPSA 2026–2027');
});
