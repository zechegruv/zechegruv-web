// Pruebas de la lógica SQL de ZG PASS contra un Postgres 16 real.
// Arma una base nueva con 007…018 (+ 031 si existe) y corre cada caso en
// una transacción que se descarta. Uso: node sql.test.js [filtro]
const { execFileSync } = require("child_process");
const path = require("path");
const PGH = "/var/lib/postgresql/zgpass-test";
const only = process.argv[2] || process.env.ONLY || "";

execFileSync(path.join(__dirname, "sqlrun.sh"), { stdio: "inherit" });

function psql(sql) {
  return execFileSync("psql", ["-h", PGH, "-p", "55432", "-U", "postgres", "-d", "zgtest", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// Datos comunes: un evento publicado (capacidad 10, máx 2 por persona) con
// dos tipos: General (sin cupo) y VIP (cupo 1).
const SETUP = `
insert into public.pass_events (id, slug, kind, name, starts_at, capacity, max_per_buyer, status)
values ('11111111-1111-4111-8111-111111111111', 'ev', 'show', 'Ev', now() + interval '10 days', 10, 2, 'published'),
       ('22222222-2222-4222-8222-222222222222', 'ev2', 'show', 'Ev2', now() + interval '10 days', 10, 2, 'published');
insert into public.pass_ticket_types (id, event_id, name, price, quota) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'General', 100, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'VIP', 300, 1),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'General', 100, null);
`;
const EV = "'11111111-1111-4111-8111-111111111111'";
const GEN = "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'";
const VIP = "'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'";

const cases = [
  ["12 · reservar de nuevo con el mismo mail libera la reserva pendiente propia (no ZG_LIMIT)", `
    do $$
    declare a jsonb; b jsonb; st text; voids int;
    begin
      a := public.pass_reserve(${EV}, ${GEN}, 2, 'Ana', 'Prueba', 'ana@example.com');
      b := public.pass_reserve(${EV}, ${GEN}, 2, 'Ana', 'Prueba', 'ANA@example.com ');
      select status into st from public.pass_orders where id = (a->>'order_id')::uuid;
      if st <> 'cancelled' then raise exception 'la primera orden quedó %', st; end if;
      select count(*) into voids from public.pass_tickets where order_id = (a->>'order_id')::uuid and status = 'void';
      if voids <> 2 then raise exception 'entradas anuladas: %', voids; end if;
    end $$;`],
  ["12 · una entrada PAGA del mismo mail sigue contando para el límite", `
    do $$
    declare a jsonb; ok boolean := false;
    begin
      a := public.pass_reserve(${EV}, ${GEN}, 2, 'Ana', 'Prueba', 'ana@example.com');
      perform public.pass_confirm_paid((a->>'order_id')::uuid, 'mercadopago', 200, '999');
      begin
        perform public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Prueba', 'ana@example.com');
      exception when others then ok := sqlerrm = 'ZG_LIMIT';
      end;
      if not ok then raise exception 'debía dar ZG_LIMIT'; end if;
    end $$;`],
  ["12 · la orden guarda el link de pago (pay_url)", `
    select 1/count(*) from information_schema.columns where table_name = 'pass_orders' and column_name = 'pay_url';`],
  ["47 · pago con la reserva vencida respeta el cupo del tipo de entrada", `
    do $$
    declare a jsonb; b jsonb; r jsonb;
    begin
      a := public.pass_reserve(${EV}, ${VIP}, 1, 'Ana', 'Uno', 'uno@example.com');
      update public.pass_orders set expires_at = now() - interval '1 minute' where id = (a->>'order_id')::uuid;
      b := public.pass_reserve(${EV}, ${VIP}, 1, 'Beto', 'Dos', 'dos@example.com');
      perform public.pass_confirm_paid((b->>'order_id')::uuid, 'mercadopago', 300, '1001');
      r := public.pass_confirm_paid((a->>'order_id')::uuid, 'mercadopago', 300, '1002');
      if r->>'result' <> 'no_capacity' then raise exception 'resultado %', r->>'result'; end if;
    end $$;`],
  ["47 · pago con la reserva vencida y cupo libre se confirma", `
    do $$
    declare a jsonb; r jsonb;
    begin
      a := public.pass_reserve(${EV}, ${VIP}, 1, 'Ana', 'Uno', 'uno@example.com');
      update public.pass_orders set expires_at = now() - interval '1 minute' where id = (a->>'order_id')::uuid;
      r := public.pass_confirm_paid((a->>'order_id')::uuid, 'mercadopago', 300, '1003');
      if r->>'result' <> 'paid' then raise exception 'resultado %', r->>'result'; end if;
    end $$;`],
  ["30/33 · misma clave de idempotencia devuelve la misma orden (no emite dos veces)", `
    do $$
    declare a jsonb; b jsonb; n int;
    begin
      a := public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Uno', null, 'door', 5, null, 'normal', null, null, false, 'door:abc12345');
      perform public.pass_confirm_paid((a->>'order_id')::uuid, 'cash', 100);
      b := public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Uno', null, 'door', 5, null, 'normal', null, null, false, 'door:abc12345');
      if a->>'order_id' <> b->>'order_id' then raise exception 'otra orden'; end if;
      if not (b->>'reused')::boolean then raise exception 'sin reused'; end if;
      select count(*) into n from public.pass_orders where event_id = ${EV};
      if n <> 1 then raise exception 'órdenes: %', n; end if;
    end $$;`],
  ["30/33 · la clave de otro evento no devuelve esa orden", `
    do $$
    declare ok boolean := false;
    begin
      perform public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Uno', null, 'door', 5, null, 'normal', null, null, false, 'door:zzz12345');
      begin
        perform public.pass_reserve('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, 'Ana', 'Uno', null, 'door', 5, null, 'normal', null, null, false, 'door:zzz12345');
      exception when others then ok := sqlerrm = 'ZG_IDEM';
      end;
      if not ok then raise exception 'debía dar ZG_IDEM'; end if;
    end $$;`],
  ["31 · los códigos visibles nuevos son aleatorios (sin 0/O/1/I/L), únicos y no correlativos", `
    do $$
    declare a jsonb; i int; codes text[]; bad int; seq int;
    begin
      update public.pass_events set capacity = 100 where id = ${EV};
      for i in 1..30 loop
        a := public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'N' || i, null, 'door', 5);
        perform public.pass_confirm_paid((a->>'order_id')::uuid, 'cash', 100);
      end loop;
      select array_agg(code order by created_at) into codes from public.pass_tickets where event_id = ${EV} and status = 'valid';
      if array_length(codes, 1) <> 30 then raise exception 'emitidas: %', array_length(codes, 1); end if;
      select count(*) into bad from unnest(codes) c where c !~ ('^ZG-' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YY') || '-[A-HJKMNP-Z2-9]{6}$');
      if bad > 0 then raise exception 'formato: %', codes[1]; end if;
      if (select count(distinct c) from unnest(codes) c) <> 30 then raise exception 'repetidos'; end if;
      select count(*) into seq from unnest(codes) c where c ~ '^ZG-[0-9]{2}-[0-9]{6}$';
      if seq > 0 then raise exception 'correlativos: %', seq; end if;
    end $$;`],
  ["31 · las entradas ya vendidas conservan su código", `
    do $$
    declare a jsonb; c text;
    begin
      a := public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Vieja', null, 'door', 5);
      update public.pass_tickets set status = 'valid', code = 'ZG-26-000123' where order_id = (a->>'order_id')::uuid;
      update public.pass_orders set status = 'paid' where id = (a->>'order_id')::uuid;
      perform public.pass_confirm_paid((a->>'order_id')::uuid, 'cash', 100);
      select code into c from public.pass_tickets where order_id = (a->>'order_id')::uuid;
      if c <> 'ZG-26-000123' then raise exception 'cambió a %', c; end if;
    end $$;`],
  ["31 · si el código al azar ya existe, se genera otro (unicidad garantizada)", `
    create sequence public.fake_seq;
    create or replace function public.pass_ticket_code() returns text language sql volatile as $f$
      select case when nextval('public.fake_seq') = 1 then 'ZG-26-AAAAAA' else 'ZG-26-BBBBBB' end $f$;
    do $$
    declare a jsonb; b jsonb; c text;
    begin
      a := public.pass_reserve(${EV}, ${GEN}, 1, 'Ana', 'Uno', null, 'door', 5);
      update public.pass_tickets set status = 'valid', code = 'ZG-26-AAAAAA' where order_id = (a->>'order_id')::uuid;
      b := public.pass_reserve(${EV}, ${GEN}, 1, 'Beto', 'Dos', null, 'door', 5);
      perform public.pass_confirm_paid((b->>'order_id')::uuid, 'cash', 100);
      select code into c from public.pass_tickets where order_id = (b->>'order_id')::uuid;
      if c <> 'ZG-26-BBBBBB' then raise exception 'quedó %', c; end if;
    end $$;`],
  ["X1 · límite de reservas por IP: 6 cada 15 minutos", `
    do $$
    declare i int; r boolean;
    begin
      for i in 1..6 loop
        if not public.pass_rate_hit('ip:1.2.3.4', 6, 15) then raise exception 'cortó en %', i; end if;
      end loop;
      if public.pass_rate_hit('ip:1.2.3.4', 6, 15) then raise exception 'dejó pasar la 7ª'; end if;
      if not public.pass_rate_hit('ip:5.6.7.8', 6, 15) then raise exception 'otra IP bloqueada'; end if;
    end $$;`],
  ["X3 · código de puerta: cada intento fallido suma en la base, 10 bloquean, el correcto pone en 0", `
    do $$
    declare acc uuid; r jsonb; i int;
    begin
      insert into public.pass_door_access (event_id, label, pin) values (${EV}, 'Puerta', '1234') returning id into acc;
      r := public.pass_door_try(acc, '0000');
      if r->>'result' <> 'wrong' or (r->>'tries')::int <> 1 then raise exception 'primer intento %', r; end if;
      r := public.pass_door_try(acc, '1234');
      if r->>'result' <> 'ok' then raise exception 'correcto %', r; end if;
      if (select failed_attempts from public.pass_door_access where id = acc) <> 0 then raise exception 'no volvió a 0'; end if;
      for i in 1..10 loop r := public.pass_door_try(acc, '9999'); end loop;
      r := public.pass_door_try(acc, '1234');
      if r->>'result' <> 'locked' then raise exception 'debía estar bloqueado: %', r; end if;
    end $$;`],
];

let pass = 0, fail = 0;
for (const [name, sql] of cases) {
  if (only && !name.startsWith(only)) continue;
  try {
    psql(`begin;\n${SETUP}\n${sql}\nrollback;`);
    console.log(`PASS  ${name}`); pass++;
  } catch (e) {
    const msg = String(e.stderr || e.message).split("\n").filter((l) => /ERROR|CONTEXT/.test(l))[0] || String(e.stderr || e.message).trim();
    console.log(`FAIL  ${name}\n      ${msg}`); fail++;
  }
}
// X3 con pedidos de verdad en paralelo (20 conexiones a la vez, código mal):
// tienen que quedar exactamente 10 fallidos contados y 10 rechazados por bloqueo.
async function parallel() {
  const name = "X3 · 20 intentos en paralelo: cuenta exactamente 10 y bloquea el resto";
  if (only && !name.startsWith(only)) return;
  try {
    psql(`${SETUP} insert into public.pass_door_access (id, event_id, label, pin) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ${EV}, 'P', '1234');`);
    const { spawn } = require("child_process");
    const r = await Promise.all(Array.from({ length: 20 }, () => new Promise((resolve) => {
      const p = spawn("psql", ["-h", PGH, "-p", "55432", "-U", "postgres", "-d", "zgtest", "-qAt", "-c", "select public.pass_door_try('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '0000')->>'result'"]);
      let out = ""; p.stdout.on("data", (d) => { out += d; }); p.on("close", () => resolve(out.trim()));
    })));
    const tries = psql("select failed_attempts from public.pass_door_access where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'").trim();
    const wrong = r.filter((x) => x === "wrong").length, locked = r.filter((x) => x === "locked").length;
    if (tries === "10" && wrong === 10 && locked === 10) { console.log(`PASS  ${name}`); pass++; }
    else { console.log(`FAIL  ${name}\n      contados ${tries}, wrong ${wrong}, locked ${locked}`); fail++; }
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${String(e.stderr || e.message).trim().split("\n")[0]}`); fail++;
  }
}
parallel().then(() => {
  console.log(`\nSQL: ${pass} ok, ${fail} con fallas`);
  process.exitCode = fail ? 1 : 0;
});
