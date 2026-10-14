import { guarded, requirePermission, response, body, fail, identifier } from "../lib/security.mjs";
import { db, authAdmin } from "../lib/database.mjs";
import { readEvents } from "./events.mjs";
import { operationsStore, checkinKey } from "../lib/checkins.mjs";
import { JSON_READ } from "../lib/blob-state.mjs";
import { paged } from "../lib/raffles.mjs";
import { accountsStore, readModeration, accountId, safeAccount, readAuthAccounts,
  readAccountProfiles, accountQuery, setNameVisibility } from "../lib/accounts.mjs";

async function accountHistory(userId, read, events, storage) {
  const [claims, catalog] = await Promise.all([
    paged(`attendance?user_id=eq.${userId}&select=event_id,event_title,ticket_id,created_at&order=event_id.asc`, read, { cursor: ["event_id"] }),
    events(),
  ]);
  const eventMap = new Map(catalog.map(event => [identifier(event.id), event]));
  const history = new Map();
  const byTicket = new Map();
  for (const claim of claims) {
    const eventId = identifier(claim.event_id), event = eventMap.get(eventId);
    if (typeof claim.event_title !== "string" || typeof claim.created_at !== "string" || !Number.isFinite(Date.parse(claim.created_at)))
      fail(503, "Katılım geçmişi doğrulanamadı.");
    byTicket.set(identifier(claim.ticket_id), eventId);
    history.set(eventId, { eventId, title: event?.title || claim.event_title,
      date: event?.date || "", time: event?.time || "", location: event?.location || "",
      archived: !event, claimedAt: claim.created_at, enteredAt: null });
  }
  let checkinsAvailable = true;
  try {
    const eventIds = new Set([...eventMap.keys(), ...history.keys()]);
    // Archived events can have gate history even when an attendance row no
    // longer exists. Netlify's paginated listing avoids silently losing them.
    let listed = 0;
    for await (const page of storage.list({ prefix: "checkins/events/", paginate: true })) {
      if (!Array.isArray(page?.blobs)) throw Error("Invalid check-in listing");
      for (const { key } of page.blobs) {
        if (++listed > 10000 || typeof key !== "string") throw Error("Invalid check-in listing");
        const match = key.match(/^checkins\/events\/([A-Za-z0-9_-]+)\.json$/);
        if (!match) throw Error("Invalid check-in key");
        eventIds.add(identifier(match[1]));
      }
    }
    for (const eventIdsPage of Array.from({ length: Math.ceil(eventIds.size / 10) }, (_, index) => [...eventIds].slice(index * 10, index * 10 + 10))) {
      const pages = await Promise.all(eventIdsPage.map(async eventId => {
        const snapshot = await storage.getWithMetadata(checkinKey(eventId), JSON_READ);
        if (snapshot && (!snapshot.data || !Array.isArray(snapshot.data.entries))) throw Error("Invalid check-in data");
        return { eventId, entries: snapshot ? snapshot.data.entries : [] };
      }));
      for (const { eventId, entries } of pages) {
        if (!Array.isArray(entries)) throw Error("Invalid check-in data");
        for (const entry of entries) {
          if (!entry || typeof entry.ticketId !== "string" || typeof entry.enteredAt !== "string" || !Number.isFinite(Date.parse(entry.enteredAt))) throw Error("Invalid check-in data");
          const belongsByTicket = byTicket.get(entry.ticketId) === eventId;
          if (entry.userId !== userId && !belongsByTicket) continue;
          const event = eventMap.get(eventId);
          if (!history.has(eventId)) history.set(eventId, { eventId, title: event?.title || "Arşivlenmiş etkinlik",
            date: event?.date || "", time: event?.time || "", location: event?.location || "",
            archived: !event, claimedAt: null, enteredAt: null });
          const item = history.get(eventId);
          if (!item.enteredAt || Date.parse(entry.enteredAt) < Date.parse(item.enteredAt)) item.enteredAt = entry.enteredAt;
        }
      }
    }
  } catch {
    checkinsAvailable = false;
    // A partial read cannot safely assert either presence or absence. Keep
    // only independently verified claims and mark all gate statuses unknown.
    for (const [id, item] of history) {
      if (!item.claimedAt) history.delete(id);
      else item.enteredAt = null;
    }
  }
  const attendance = [...history.values()].sort((a, b) =>
    Date.parse(b.enteredAt || b.claimedAt) - Date.parse(a.enteredAt || a.claimedAt));
  return { attendance, claimTotal: claims.length, entryTotal: checkinsAvailable ? attendance.filter(item => item.enteredAt).length : null, checkinsAvailable };
}

export function createAccountsHandler({ read = db, auth = authAdmin, events = readEvents,
  moderation = accountsStore, store = operationsStore, now = () => new Date(), adminStore } = {}) {
  return guarded(async req => {
    await requirePermission(req, req.method === "GET" ? "accounts.view" : "accounts.manage", { getStore: adminStore });
    const url = new URL(req.url), action = url.searchParams.get("action") || "list";
    if (req.method === "POST" && action === "visibility") {
      const input = await body(req), userId = accountId(input.userId);
      if (typeof input.hidden !== "boolean") fail(400, "Gizleme tercihi gerekli.");
      // Validate the Auth account before adding a durable override.
      const result = await auth(`users/${userId}`);
      const user = result?.user || result;
      if (accountId(user?.id) !== userId) fail(503, "Hesap doğrulanamadı.");
      return response(await setNameVisibility(moderation(), userId, input.hidden, now()));
    }
    if (req.method !== "GET" || !["list", "detail"].includes(action)) fail(405, "Desteklenmeyen işlem.");
    const rawId = url.searchParams.get("userId") || url.searchParams.get("id");
    if (rawId) {
      const userId = accountId(rawId);
      const [result, profiles, visibility] = await Promise.all([
        auth(`users/${userId}`), readAccountProfiles([userId], read), readModeration(moderation()),
      ]);
      const user = result?.user || result;
      if (accountId(user?.id) !== userId) fail(503, "Hesap doğrulanamadı.");
      const account = safeAccount(user, profiles[0], visibility);
      return response({ account, ...await accountHistory(userId, read, events, store()) });
    }
    const { page, search } = accountQuery(url), pageSize = 50;
    const users = await readAuthAccounts(auth);
    const [profiles, visibility] = await Promise.all([
      readAccountProfiles(users.map(user => user.id), read), readModeration(moderation()),
    ]);
    const byId = new Map(profiles.map(profile => [accountId(profile.id), profile]));
    const accounts = users.map(user => safeAccount(user, byId.get(accountId(user.id)), visibility))
      .filter(account => !search || `${account.name} ${account.email}`.toLocaleLowerCase("tr").includes(search))
      .sort((a, b) => a.name.localeCompare(b.name, "tr") || a.email.localeCompare(b.email) || a.id.localeCompare(b.id));
    const total = accounts.length, pages = Math.max(1, Math.ceil(total / pageSize));
    return response({ accounts: accounts.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, pages });
  });
}
export default createAccountsHandler();
