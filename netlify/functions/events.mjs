import { getStore } from '@netlify/blobs';

const STORE_NAME = 'ercupsa-content';
const KEY = 'events.json';

const seedEvents = [
  {
    id: 'cigkofte-2026',
    title: '3. Çiğköfte Partisi',
    category: 'Tanışma / Eğlence',
    date: '2026-09-01',
    time: '',
    location: '',
    description: 'ERCUPSA ailesiyle yeni döneme keyifli bir başlangıç.',
    registrationUrl: '',
    poster: '',
    images: [],
    createdAt: '2026-08-01T00:00:00.000Z'
  },
  {
    id: 'konya-unides-2026',
    title: 'Konya ÜNİDES Teknik Alan Gezisi',
    category: 'Teknik Gezi',
    date: '2026-02-01',
    time: '',
    location: 'Konya',
    description: 'ÜNİDES destekli, mesleki gelişim ve kültürel kaynaşma odaklı Konya saha programımız.',
    registrationUrl: '',
    poster: '',
    images: [],
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'fidan-2026',
    title: 'Dünya Eczacılık Günü Fidan Dikimi',
    category: 'Sosyal Sorumluluk',
    date: '2026-09-25',
    time: '',
    location: '',
    description: 'Mesleğimizin onur gününde doğaya nefes olmak için düzenlediğimiz fidan dikimi etkinliği.',
    registrationUrl: '',
    poster: '',
    images: [],
    createdAt: '2026-08-01T00:00:00.000Z'
  }
];

function store() {
  return getStore(STORE_NAME);
}

function authorized(req) {
  const password = process.env.ADMIN_PASSWORD;
  const supplied = req.headers.get('x-admin-password') || '';
  return Boolean(password && supplied && supplied === password);
}

async function readEvents() {
  const data = await store().get(KEY, {
    type: 'json',
    consistency: 'strong'
  });

  return Array.isArray(data) ? data : seedEvents;
}

export default async (req) => {
  const method = req.method.toUpperCase();

  if (method === 'GET') {
    const events = await readEvents();
    return Response.json({ events });
  }

  if (
    method === 'POST' &&
    new URL(req.url).searchParams.get('action') === 'auth'
  ) {
    return Response.json(
      { ok: authorized(req) },
      { status: authorized(req) ? 200 : 401 }
    );
  }

  if (method === 'POST') {
    if (!authorized(req)) {
      return Response.json(
        { error: 'Yetkisiz erişim.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const event = body?.event;

    if (!event?.title || !event?.date) {
      return Response.json(
        { error: 'Etkinlik adı ve tarih zorunludur.' },
        { status: 400 }
      );
    }

    const events = await readEvents();

    const normalized = {
      id: event.id || crypto.randomUUID(),
      title: String(event.title).trim(),
      category: String(event.category || 'Etkinlik').trim(),
      date: String(event.date),
      time: String(event.time || '').trim(),
      location: String(event.location || '').trim(),
      description: String(event.description || '').trim(),
      registrationUrl: String(event.registrationUrl || '').trim(),
      poster: String(event.poster || '').trim(),
      images: Array.isArray(event.images) ? event.images : [],
      createdAt: event.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const index = events.findIndex(
      (item) => item.id === normalized.id
    );

    if (index >= 0) {
      events[index] = normalized;
    } else {
      events.unshift(normalized);
    }

    await store().setJSON(KEY, events);

    return Response.json({
      ok: true,
      event: normalized,
      events
    });
  }

  if (method === 'DELETE') {
    if (!authorized(req)) {
      return Response.json(
        { error: 'Yetkisiz erişim.' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return Response.json(
        { error: 'Etkinlik ID gerekli.' },
        { status: 400 }
      );
    }

    const events = await readEvents();
    const next = events.filter((item) => item.id !== id);

    await store().setJSON(KEY, next);

    return Response.json({
      ok: true,
      events: next
    });
  }

  return Response.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
};
