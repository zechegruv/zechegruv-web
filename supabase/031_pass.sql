-- ZECHE GRUV — ZG PASS · Arreglos de venta, pago y puerta
--   · Quien vuelve de Mercado Pago sin pagar puede volver a intentar: la
--     orden guarda su link de pago, y una compra nueva con el mismo mail para
--     el mismo evento libera primero las reservas pendientes de ese mail
--     (antes contaban para el máximo por persona y la bloqueaban).
--   · Ventas en puerta y listas de invitados sin entradas dobles: cada
--     pedido lleva una clave única (idem_key); si se repite (se cortó la
--     conexión y se reintentó), se devuelve la misma orden en vez de otra.
--   · Un pago que llega con la reserva vencida respeta también el cupo del
--     tipo de entrada (antes solo se miraba la capacidad total).
--   · Los códigos visibles de las entradas nuevas salen al azar (ya no
--     correlativos). Las ya vendidas conservan el suyo.
--   · Límite de reservas por conexión (para que nadie retenga lugares con
--     mails inventados) y código de puerta con los intentos contados en la
--     base, de a uno (con pedidos en paralelo no se pueden probar más).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una
-- vez. Correrlo ANTES de publicar el código nuevo de las functions.

-- ---------- Órdenes: link de pago y clave única del pedido ----------
alter table public.pass_orders
  add column if not exists pay_url text,     -- link de Mercado Pago de esta orden (vale mientras dure la reserva)
  add column if not exists idem_key text;    -- clave única del pedido que la creó (puerta, invitados)
create unique index if not exists pass_orders_idem_key on public.pass_orders (idem_key) where idem_key is not null;

-- ---------- Reservar lugares ----------
-- Igual que en 007, con dos cambios:
--   · p_idem: si ya hay una orden con esa clave (mismo evento), se devuelve
--     esa ("reused": true) y no se crea otra.
--   · En la web, antes de contar el máximo por persona se cancelan las
--     reservas pendientes de ese mail para ese evento: es la misma persona
--     volviendo a intentar. Las entradas ya pagas siguen contando.
-- Lleva un parámetro más, así que se reemplaza la versión anterior.
drop function if exists public.pass_reserve(uuid, uuid, integer, text, text, text, text, integer, numeric, text, uuid, uuid, boolean);

create or replace function public.pass_reserve(
  p_event uuid,
  p_type uuid,
  p_qty integer,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_channel text default 'web',
  p_hold_minutes integer default 15,
  p_unit_price numeric default null,
  p_modality text default 'normal',
  p_profile uuid default null,
  p_admin uuid default null,
  p_test boolean default false,
  p_idem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pass_events%rowtype;
  v_type public.pass_ticket_types%rowtype;
  v_order public.pass_orders%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_idem text := nullif(trim(coalesce(p_idem, '')), '');
  v_price numeric(12, 2);
  v_mine integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 20 then raise exception 'ZG_QTY'; end if;
  if v_first = '' or v_last = '' then raise exception 'ZG_NAME'; end if;

  select * into v_event from public.pass_events where id = p_event for update;
  if not found then raise exception 'ZG_NO_EVENT'; end if;

  -- Pedido repetido (misma clave): se devuelve la orden que ya existe. Con
  -- la fila del evento bloqueada, dos reintentos simultáneos no se cruzan.
  if v_idem is not null then
    select * into v_order from public.pass_orders where idem_key = v_idem;
    if found then
      if v_order.event_id <> p_event then raise exception 'ZG_IDEM'; end if;
      return jsonb_build_object(
        'order_id', v_order.id,
        'number', v_order.number,
        'access_token', v_order.access_token,
        'total', v_order.total,
        'expires_at', v_order.expires_at,
        'reused', true
      );
    end if;
  end if;

  select * into v_type from public.pass_ticket_types where id = p_type and event_id = p_event;
  if not found then raise exception 'ZG_NO_TYPE'; end if;
  if v_event.status = 'cancelled' then raise exception 'ZG_CLOSED'; end if;

  if p_channel = 'web' then
    if v_email is null then raise exception 'ZG_EMAIL'; end if;
    if v_event.status <> 'published'
       or v_event.is_test <> p_test
       or not v_type.active
       or now() < coalesce(v_event.sales_start, '-infinity'::timestamptz)
       or now() > coalesce(v_event.sales_end, v_event.starts_at) then
      raise exception 'ZG_CLOSED';
    end if;
    -- La misma persona vuelve a intentar: sus reservas sin pagar se liberan.
    -- (Si una de esas llegara a pagarse igual, Mercado Pago lo devuelve solo:
    -- la orden cancelada no se puede pagar.)
    update public.pass_tickets set status = 'void'
    where status = 'reserved'
      and order_id in (select id from public.pass_orders
                       where event_id = p_event and buyer_email = v_email and channel = 'web' and status = 'pending');
    update public.pass_orders set status = 'cancelled', updated_at = now()
    where event_id = p_event and buyer_email = v_email and channel = 'web' and status = 'pending';
    -- Límite por persona: lo que ya tiene ese mail en este evento.
    select count(*) into v_mine
    from public.pass_tickets t
    join public.pass_orders o on o.id = t.order_id
    where t.event_id = p_event
      and t.holder_email = v_email
      and (t.status in ('valid', 'used')
           or (t.status = 'reserved' and o.status = 'pending' and o.expires_at > now()));
    if v_mine + p_qty > v_event.max_per_buyer then raise exception 'ZG_LIMIT'; end if;
    v_price := v_type.price;
  else
    v_price := coalesce(p_unit_price, v_type.price);
    if v_price < 0 then raise exception 'ZG_PRICE'; end if;
  end if;

  if public.pass_taken(p_event) + p_qty > v_event.capacity then raise exception 'ZG_SOLD_OUT'; end if;
  if v_type.quota is not null and public.pass_taken(p_event, p_type) + p_qty > v_type.quota then
    raise exception 'ZG_SOLD_OUT';
  end if;

  insert into public.pass_orders (event_id, buyer_first_name, buyer_last_name, buyer_email, channel, total, expires_at, is_test, created_by, idem_key)
  values (p_event, v_first, v_last, v_email, p_channel, v_price * p_qty,
          now() + make_interval(mins => greatest(coalesce(p_hold_minutes, 15), 1)), v_event.is_test, p_admin, v_idem)
  returning * into v_order;

  insert into public.pass_tickets (order_id, event_id, ticket_type_id, holder_name, holder_email, profile_id, face_value, price_paid, modality)
  select v_order.id, p_event, p_type, v_first || ' ' || v_last, v_email, p_profile, v_type.price, v_price, p_modality
  from generate_series(1, p_qty);

  return jsonb_build_object(
    'order_id', v_order.id,
    'number', v_order.number,
    'access_token', v_order.access_token,
    'total', v_order.total,
    'expires_at', v_order.expires_at,
    'reused', false
  );
end;
$$;

-- ---------- Código visible de cada entrada ----------
-- ZG-<año>-<6 letras y números al azar>, p. ej. ZG-26-K7Q4X2. Sin 0/O,
-- 1/I/L, para que no se confundan al leerlos. Ya no son correlativos: no
-- se puede adivinar el de otra entrada a partir del propio. Las entradas
-- que ya tenían código lo conservan (y entran igual, con su QR).
create or replace function public.pass_ticket_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());  -- los primeros 6 bytes son al azar
  v_code text := '';
  i integer;
begin
  for i in 0..5 loop
    v_code := v_code || substr(v_chars, 1 + get_byte(v_bytes, i) % length(v_chars), 1);
  end loop;
  return 'ZG-' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YY') || '-' || v_code;
end;
$$;

-- ---------- Confirmar el pago y emitir las entradas ----------
-- Igual que en 007, con códigos visibles al azar (arriba); cuando el pago llega con la reserva vencida se vuelve a
-- comprobar la capacidad total Y el cupo de cada tipo de entrada de la
-- orden (como al reservar): si no hay lugar, no se emite y se devuelve.
create or replace function public.pass_confirm_paid(
  p_order uuid,
  p_method text,
  p_amount numeric,
  p_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pass_orders%rowtype;
  v_qty integer;
  v_capacity integer;
  v_ticket uuid;
begin
  select * into v_order from public.pass_orders where id = p_order for update;
  if not found then raise exception 'ZG_NO_ORDER'; end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'order_id', v_order.id);
  end if;
  if v_order.status in ('cancelled', 'refunded') then
    return jsonb_build_object('result', 'not_payable', 'order_id', v_order.id);
  end if;
  if p_amount is distinct from v_order.total then
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  -- Pago que llega con la reserva vencida: los lugares pudieron venderse
  -- a otra persona, así que se vuelve a comprobar la capacidad y el cupo.
  if v_order.status = 'expired' or v_order.expires_at <= now() then
    select capacity into v_capacity from public.pass_events where id = v_order.event_id for update;
    select count(*) into v_qty from public.pass_tickets where order_id = p_order;
    if public.pass_taken(v_order.event_id) + v_qty > v_capacity
       or exists (
         select 1
         from (select ticket_type_id, count(*)::integer as n
               from public.pass_tickets where order_id = p_order
               group by ticket_type_id) x
         join public.pass_ticket_types tt on tt.id = x.ticket_type_id
         where tt.quota is not null
           and public.pass_taken(v_order.event_id, x.ticket_type_id) + x.n > tt.quota
       ) then
      update public.pass_tickets set status = 'void' where order_id = p_order;
      update public.pass_orders
      set status = 'expired', mp_payment_id = coalesce(p_payment_id, mp_payment_id), updated_at = now()
      where id = p_order;
      return jsonb_build_object('result', 'no_capacity', 'order_id', v_order.id);
    end if;
  end if;

  -- Cada entrada recibe su código visible al azar (pass_ticket_code). Si
  -- justo sale uno que ya existe, la base lo rechaza (code es único) y se
  -- prueba con otro.
  for v_ticket in select id from public.pass_tickets where order_id = p_order loop
    loop
      begin
        update public.pass_tickets set status = 'valid', code = public.pass_ticket_code()
        where id = v_ticket;
        exit;
      exception when unique_violation then
        null;  -- código repetido: otra vuelta
      end;
    end loop;
  end loop;

  update public.pass_orders
  set status = 'paid', paid_at = now(), payment_method = p_method,
      mp_payment_id = coalesce(p_payment_id, mp_payment_id), updated_at = now()
  where id = p_order;

  return jsonb_build_object('result', 'paid', 'order_id', v_order.id);
end;
$$;

-- ---------- Límite de pedidos por conexión ----------
-- Cada pedido anota una marca con su clave (p. ej. la conexión, ya
-- convertida en un código que no deja ver la IP). Devuelve false si esa
-- clave ya llegó al máximo en los últimos p_minutes minutos. Dos pedidos a
-- la vez con la misma clave se atienden de a uno.
create table if not exists public.pass_rate (
  key text not null,
  hit_at timestamptz not null default now()
);
create index if not exists pass_rate_key on public.pass_rate (key, hit_at);
create index if not exists pass_rate_hit_at on public.pass_rate (hit_at);
alter table public.pass_rate enable row level security;
revoke all on public.pass_rate from anon, authenticated;
grant select, insert, delete on public.pass_rate to service_role;

create or replace function public.pass_rate_hit(p_key text, p_max integer, p_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('zg_pass_rate:' || p_key));
  -- Las marcas viejas no sirven más: se borran (las de esta clave y, de
  -- paso, las de cualquiera con más de un día).
  delete from public.pass_rate where key = p_key and hit_at < now() - make_interval(mins => p_minutes);
  delete from public.pass_rate where hit_at < now() - interval '1 day';
  select count(*) into v_count from public.pass_rate where key = p_key;
  if v_count >= p_max then return false; end if;
  insert into public.pass_rate (key) values (p_key);
  return true;
end;
$$;

-- ---------- Código de 4 números del acceso de puerta ----------
-- Compara el código y cuenta el intento en una sola operación, con la fila
-- bloqueada: con pedidos en paralelo cada intento suma de a uno y nadie
-- puede probar más de los permitidos. Devuelve "result":
--   ok      código correcto (los intentos fallidos vuelven a 0)
--   wrong   código incorrecto ("tries": intentos fallidos hasta ahora)
--   locked  el acceso ya estaba bloqueado
--   missing no existe ese acceso
create or replace function public.pass_door_try(p_access uuid, p_pin text, p_max integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.pass_door_access%rowtype;
begin
  select * into v_access from public.pass_door_access where id = p_access for update;
  if not found then return jsonb_build_object('result', 'missing'); end if;
  if v_access.failed_attempts >= p_max then
    return jsonb_build_object('result', 'locked', 'tries', v_access.failed_attempts);
  end if;
  if v_access.pin = coalesce(p_pin, '') then
    if v_access.failed_attempts <> 0 then
      update public.pass_door_access set failed_attempts = 0 where id = p_access;
    end if;
    return jsonb_build_object('result', 'ok', 'tries', 0);
  end if;
  update public.pass_door_access set failed_attempts = failed_attempts + 1
  where id = p_access
  returning failed_attempts into v_access.failed_attempts;
  return jsonb_build_object('result', 'wrong', 'tries', v_access.failed_attempts);
end;
$$;

-- Las funciones solo las ejecuta el servidor (clave secreta).
revoke execute on function public.pass_reserve(uuid, uuid, integer, text, text, text, text, integer, numeric, text, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.pass_confirm_paid(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.pass_rate_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.pass_ticket_code() from public, anon, authenticated;
revoke execute on function public.pass_door_try(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.pass_reserve(uuid, uuid, integer, text, text, text, text, integer, numeric, text, uuid, uuid, boolean, text) to service_role;
grant execute on function public.pass_confirm_paid(uuid, text, numeric, text) to service_role;
grant execute on function public.pass_rate_hit(text, integer, integer) to service_role;
grant execute on function public.pass_ticket_code() to service_role;
grant execute on function public.pass_door_try(uuid, text, integer) to service_role;

notify pgrst, 'reload schema';
