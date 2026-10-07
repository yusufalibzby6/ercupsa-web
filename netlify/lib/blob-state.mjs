import { fail } from './security.mjs';

export const JSON_READ = { type: 'json', consistency: 'strong' };
export async function mutateJson(store, key, initial, mutate) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const snap = await store.getWithMetadata(key, JSON_READ);
    if (snap && (typeof snap.etag !== 'string' || !snap.etag)) fail(503, 'Kayıt doğrulanamadı. Lütfen tekrar deneyin.');
    const data = structuredClone(snap?.data ?? initial);
    const decision = await mutate(data);
    if (decision.write === false) return decision.result;
    const result = await store.setJSON(key, data, snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (result.modified) return decision.result;
  }
  fail(409, 'Kayıt aynı anda güncellendi. Lütfen aynı işlemi yeniden deneyin.');
}
