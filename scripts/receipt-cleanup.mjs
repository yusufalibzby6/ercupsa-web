/** Read-only inventory. This script deliberately has no storage mutation path. */
import { getStore } from '@netlify/blobs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REGISTRATIONS = 'ercupsa-registrations';
const RECEIPTS = 'ercupsa-registration-receipts';
const READ = { type: 'json', consistency: 'strong' };

async function keys(store, prefix) {
  const result = [];
  for await (const page of store.list({ ...(prefix ? { prefix } : {}), paginate: true })) {
    if (!Array.isArray(page?.blobs)) throw Error('Depo envanteri doğrulanamadı.');
    for (const blob of page.blobs) {
      if (!blob || typeof blob.key !== 'string' || !blob.key) throw Error('Depo anahtarı doğrulanamadı.');
      result.push(blob.key);
    }
  }
  return result;
}

export async function inventoryReceipts({ store = getStore, now = () => new Date() } = {}) {
  const registrations = store({ name: REGISTRATIONS, consistency: 'strong' });
  const receipts = store({ name: RECEIPTS, consistency: 'strong' });
  const [states, legacy, files] = await Promise.all([
    keys(registrations, 'state/'), keys(registrations, 'entries/'), keys(receipts),
  ]);
  const canonicalEvents = new Set(), references = new Set(), superseded = new Set();
  let activeRegistrationReferences = 0, deletedRecordReferences = 0, supersededLegacyReferences = 0;
  const reference = (key, set = references) => {
    if (typeof key !== 'string' || !key || key.length > 2048) throw Error('Dekont referansı doğrulanamadı.');
    set.add(key);
  };
  for (const key of states) {
    const match = /^state\/([^/]+)\.json$/.exec(key);
    if (!match) throw Error('Kayıt deposundaki durum anahtarı doğrulanamadı.');
    const state = await registrations.get(key, READ);
    if (!state || !Array.isArray(state.entries) || !Array.isArray(state.deleted || [])) throw Error('Kayıt durumu okunamadı; eksik envanterle devam edilmedi.');
    canonicalEvents.add(match[1]);
    for (const entry of state.entries) if (entry.receipt) { reference(entry.receipt.key); activeRegistrationReferences++; }
    for (const entry of state.deleted || []) if (entry.receiptKey) { reference(entry.receiptKey); deletedRecordReferences++; }
  }
  for (const key of legacy) {
    const match = /^entries\/([^/]+)\/[^/]+\.json$/.exec(key);
    if (!match) throw Error('Eski kayıt deposundaki anahtar doğrulanamadı.');
    const entry = await registrations.get(key, READ);
    if (!entry) throw Error('Eski kayıt okunamadı; eksik envanterle devam edilmedi.');
    if (!entry.receipt) continue;
    if (canonicalEvents.has(match[1])) { reference(entry.receipt.key, superseded); supersededLegacyReferences++; }
    else { reference(entry.receipt.key); activeRegistrationReferences++; }
  }
  const present = new Set(files), retainedReferences = new Set([...references, ...superseded]);
  return {
    mode: 'dry-run', createdAt: now().toISOString(),
    receiptFiles: present.size,
    activeRegistrationReferences, deletedRecordReferences, supersededLegacyReferences,
    referencedFiles: [...present].filter(key => retainedReferences.has(key)).length,
    orphanedFiles: [...present].filter(key => !retainedReferences.has(key)).length,
    missingReferencedFiles: [...references].filter(key => !present.has(key)).length,
    canonicalEvents: canonicalEvents.size,
    changedFiles: 0, changedRegistrations: 0,
    note: 'Yalnızca envanter oluşturuldu. Dekont içeriği indirilmedi; kayıtlar, biletler ve fotoğraflar değiştirilmedi.',
  };
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('Kullanım: node scripts/receipt-cleanup.mjs [--dry-run] [--output rapor.json]\nYalnızca mevcut Netlify Blobs ortamında salt okunur dekont envanteri çıkarır. Silme işlemi içermez. Kimlik bilgilerini komut satırına yazmayın.');
    return;
  }
  let output;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') continue;
    if (args[index] === '--output' && args[index + 1]) { output = args[++index]; continue; }
    throw Error('Geçersiz seçenek. Bu araç yalnızca --dry-run ve --output destekler; silme işlemi yapmaz.');
  }
  const report = JSON.stringify(await inventoryReceipts(), null, 2) + '\n';
  if (output) await writeFile(output, report, { flag: 'wx', mode: 0o600 });
  console.log(report.trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Dekont envanteri tamamlanamadı. Ortam bağlantısını ve --help seçeneklerini kontrol edin. Hiçbir veri değiştirilmedi.');
    process.exitCode = 1;
  });
}
