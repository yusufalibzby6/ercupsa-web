import { getStore as getBlobStore } from "@netlify/blobs";
import { readEvents as readStoredEvents } from "./events.mjs";
import { guarded, requireAdmin, response, identifier, fail } from "../lib/security.mjs";
import { readTicketDesignBody, validateTicketDesign } from "../lib/ticket-design.mjs";

export function createTicketDesignHandler({
  getStore = getBlobStore,
  readEvents = readStoredEvents,
  now = () => new Date(),
} = {}) {
  return guarded(async (req) => {
    requireAdmin(req);
    if (!["GET", "POST", "DELETE"].includes(req.method))
      fail(405, "Desteklenmeyen işlem.");
    const id = identifier(new URL(req.url).searchParams.get("event_id"));
    // Ticket batches remain printable after an event is removed from the site.
    // Only a new upload needs a currently saved event; retained art can be read/reset.
    if (req.method === "POST") {
      const events = await readEvents();
      if (!events.some((event) => event.id === id))
        fail(404, "Etkinlik bulunamadı. Önce etkinliği kaydedin.");
    }
    const store = getStore("ercupsa-ticket-designs");
    if (req.method === "GET") {
      const design = await store.get(id, { type: "json", consistency: "strong" });
      return response({ design: design || null });
    }
    if (req.method === "DELETE") {
      await store.delete(id);
      return response({ ok: true, design: null });
    }
    const bytes = await readTicketDesignBody(req);
    const format = validateTicketDesign(bytes, req.headers.get("content-type"));
    const design = {
      ...format,
      dataUrl: `data:${format.mime};base64,${bytes.toString("base64")}`,
      updatedAt: now().toISOString(),
    };
    await store.setJSON(id, design);
    return response({ ok: true, design });
  });
}

export default createTicketDesignHandler();
