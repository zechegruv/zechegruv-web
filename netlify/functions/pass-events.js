// GET /.netlify/functions/pass-events            → eventos a la venta
// GET /.netlify/functions/pass-events?slug=…     → un evento
// Datos públicos de los eventos de ZG PASS, con sus tipos de entrada y los
// lugares que quedan. En el sitio de pruebas devuelve solo los eventos de
// prueba; en el real, nunca.
const { json, db, dbDetail, rpc, testMode, serviceKey } = require("./_lib/pass");

const FIELDS = "id,slug,kind,name,description,image_url,starts_at,ends_at,venue_name,venue_address,important_info,capacity,max_per_buyer,status,sales_start,sales_end,openmic_enabled,openmic_deadline,pass_ticket_types(id,name,description,price,quota,active,sort)";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta configurar el servidor." });

  const slug = String((event.queryStringParameters || {}).slug || "").toLowerCase();
  if (slug && !/^[a-z0-9-]{1,80}$/.test(slug)) return json(404, { error: "No encontramos ese evento." });

  const filters = [`is_test=eq.${testMode()}`, "status=in.(published,closed)", `select=${FIELDS}`, "order=starts_at.asc"];
  if (slug) filters.push(`slug=eq.${slug}`);
  else filters.push(`starts_at=gte.${new Date(Date.now() - 6 * 3600 * 1000).toISOString()}`);
  const res = await db(`pass_events?${filters.join("&")}`);
  if (!res.ok) return json(502, { error: "No pudimos cargar los eventos. Probá de nuevo en un rato.", detail: dbDetail(res) });

  const now = Date.now();
  const events = await Promise.all(res.data.map(async (e) => {
    const taken = await rpc("pass_taken", { p_event: e.id });
    const remaining = Math.max(0, e.capacity - (taken.ok ? taken.data : e.capacity));
    const open = e.status === "published"
      && (!e.sales_start || now >= Date.parse(e.sales_start))
      && now <= Date.parse(e.sales_end || e.starts_at);
    return {
      slug: e.slug,
      kind: e.kind,
      name: e.name,
      description: e.description,
      image_url: e.image_url,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      venue_name: e.venue_name,
      venue_address: e.venue_address,
      important_info: e.important_info,
      max_per_buyer: e.max_per_buyer,
      on_sale: open && remaining > 0,
      sold_out: remaining === 0,
      // No se publica el número exacto salvo cuando quedan pocas.
      few_left: remaining > 0 && remaining <= 10 ? remaining : null,
      openmic_open: e.openmic_enabled && (!e.openmic_deadline || now <= Date.parse(e.openmic_deadline)),
      ticket_types: (e.pass_ticket_types || [])
        .filter((t) => t.active)
        .sort((a, b) => a.sort - b.sort)
        .map((t) => ({ id: t.id, name: t.name, description: t.description, price: Number(t.price) })),
    };
  }));

  if (slug) return events[0] ? json(200, events[0]) : json(404, { error: "No encontramos ese evento." });
  return json(200, { events });
};
