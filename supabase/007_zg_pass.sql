-- ZECHE GRUV — ZG PASS
-- Etapa 3: base de datos de las entradas (eventos, tipos de entrada,
-- órdenes, entradas, ingresos e historial).
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.
--
-- Ninguna de estas tablas se puede leer ni escribir desde el navegador:
-- tienen la seguridad por fila activada y ninguna política, así que solo
-- las tocan las Netlify Functions con la clave secreta. Lo mismo las
-- funciones de más abajo: solo las puede ejecutar el servidor.

-- ---------- Eventos ----------
create table public.pass_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,               -- parte de la dirección: /pass/<slug>
  kind text not null check (kind in ('show', 'camp', 'other')),  -- define la estética de la entrada
  name text not null,
  description text,
  image_url text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text,
  venue_address text,
  important_info text,
  capacity integer not null check (capacity >= 0),
  max_per_buyer integer not null default 2 check (max_per_buyer > 0),
  -- draft: no se ve · published: a la venta · closed: venta cerrada ·
  -- cancelled: evento cancelado
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'cancelled')),
  sales_start timestamptz,                 -- vacío: se vende desde que se publica
  sales_end timestamptz,                   -- vacío: se vende hasta la hora del evento
  is_test boolean not null default false,  -- evento de prueba: solo en el sitio de pruebas
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Tipos de entrada ----------
create table public.pass_ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pass_events (id) on delete restrict,
  name text not null,
  description text,
  price numeric(12, 2) not null check (price >= 0),  -- valor nominal, en pesos
  quota integer check (quota >= 0),                  -- cupo propio; vacío: solo rige la capacidad del evento
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Órdenes (una compra, con una o más entradas) ----------
create sequence public.pass_order_seq;
create sequence public.pass_ticket_seq;

create table public.pass_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('ZG-' || lpad(nextval('public.pass_order_seq')::text, 6, '0')),
  -- Clave larga al azar con la que el comprador vuelve a ver su orden.
  access_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  event_id uuid not null references public.pass_events (id) on delete restrict,
  buyer_first_name text not null,
  buyer_last_name text not null,
  buyer_email text,                        -- en minúsculas; puede faltar en venta en puerta
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  channel text not null check (channel in ('web', 'door', 'admin')),
  payment_method text check (payment_method in ('mercadopago', 'cash', 'transfer', 'none')),
  total numeric(12, 2) not null check (total >= 0),
  currency text not null default 'ARS',
  expires_at timestamptz not null,         -- hasta cuándo se guardan los lugares sin pagar
  mp_preference_id text,
  mp_payment_id text,
  paid_at timestamptz,
  email_sent_at timestamptz,
  is_test boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,  -- admin, en venta en puerta o bonificadas
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index pass_orders_mp_payment on public.pass_orders (mp_payment_id) where mp_payment_id is not null;
create index pass_orders_pending on public.pass_orders (expires_at) where status = 'pending';
create index pass_orders_event on public.pass_orders (event_id);

-- ---------- Entradas ----------
create table public.pass_tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique,                        -- identificador visible (ZG-26-000184); se asigna al emitirla
  -- Lo que lleva el QR: clave larga al azar, imposible de adivinar a
  -- partir del identificador visible.
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  order_id uuid not null references public.pass_orders (id) on delete restrict,
  event_id uuid not null references public.pass_events (id) on delete restrict,
  ticket_type_id uuid not null references public.pass_ticket_types (id) on delete restrict,
  holder_name text not null,
  holder_email text,
  profile_id uuid references public.profiles (id) on delete set null,  -- artista del portal, si corresponde
  face_value numeric(12, 2) not null,      -- valor nominal
  price_paid numeric(12, 2) not null,      -- lo que se pagó de verdad
  discount numeric(12, 2) generated always as (face_value - price_paid) stored,
  -- normal · presale: preventa · promo: con código · comp: bonificada
  modality text not null default 'normal' check (modality in ('normal', 'presale', 'promo', 'comp')),
  promo_code text,
  -- reserved: lugar guardado, sin pagar · valid: emitida · used: ya ingresó ·
  -- void: anulada (orden vencida, cancelada o reembolsada)
  status text not null default 'reserved' check (status in ('reserved', 'valid', 'used', 'void')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index pass_tickets_event on public.pass_tickets (event_id, status);
create index pass_tickets_order on public.pass_tickets (order_id);
create index pass_tickets_email on public.pass_tickets (event_id, holder_email);
create index pass_tickets_profile on public.pass_tickets (profile_id) where profile_id is not null;

-- ---------- Ingresos (cada lectura de QR, válida o no) ----------
create table public.pass_checkins (
  id bigint generated always as identity primary key,
  ticket_id uuid references public.pass_tickets (id) on delete restrict,  -- vacío si el QR no existe
  event_id uuid references public.pass_events (id) on delete restrict,
  result text not null check (result in ('ok', 'already_used', 'not_valid', 'wrong_event', 'unknown')),
  admin_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index pass_checkins_event on public.pass_checkins (event_id, created_at);

-- ---------- Historial de acciones del administrador ----------
create table public.pass_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,                    -- p. ej. "venta_en_puerta", "entrada_bonificada"
  entity text,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Permisos ----------
alter table public.pass_events enable row level security;
alter table public.pass_ticket_types enable row level security;
alter table public.pass_orders enable row level security;
alter table public.pass_tickets enable row level security;
alter table public.pass_checkins enable row level security;
alter table public.pass_audit enable row level security;

revoke all on public.pass_events, public.pass_ticket_types, public.pass_orders,
  public.pass_tickets, public.pass_checkins, public.pass_audit from anon, authenticated;
grant select, insert, update on public.pass_events, public.pass_ticket_types, public.pass_orders,
  public.pass_tickets, public.pass_checkins, public.pass_audit to service_role;
revoke all on sequence public.pass_order_seq, public.pass_ticket_seq from anon, authenticated;
grant usage on sequence public.pass_order_seq, public.pass_ticket_seq to service_role;

-- ---------- Lugares ocupados ----------
-- Cuenta las entradas emitidas (pagas, bonificadas, de puerta: todas por
-- igual) más las reservadas cuya orden todavía no venció. Una reserva
-- vencida deja de contar sola, sin esperar a ninguna limpieza.
create function public.pass_taken(p_event uuid, p_type uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.pass_tickets t
  join public.pass_orders o on o.id = t.order_id
  where t.event_id = p_event
    and (p_type is null or t.ticket_type_id = p_type)
    and (t.status in ('valid', 'used')
         or (t.status = 'reserved' and o.status = 'pending' and o.expires_at > now()));
$$;

-- ---------- Reservar lugares ----------
-- Crea la orden y sus entradas en estado "reservada". Bloquea la fila del
-- evento mientras trabaja: si dos compras llegan a la vez, la segunda
-- espera a que termine la primera y ve los lugares ya descontados, así
-- nunca se vende de más.
-- En el canal "web" el precio sale siempre del tipo de entrada; el precio
-- a medida (p_unit_price) solo vale para venta en puerta y bonificadas.
create function public.pass_reserve(
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
  p_test boolean default false
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
  v_price numeric(12, 2);
  v_mine integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 20 then raise exception 'ZG_QTY'; end if;
  if v_first = '' or v_last = '' then raise exception 'ZG_NAME'; end if;

  select * into v_event from public.pass_events where id = p_event for update;
  if not found then raise exception 'ZG_NO_EVENT'; end if;
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

  insert into public.pass_orders (event_id, buyer_first_name, buyer_last_name, buyer_email, channel, total, expires_at, is_test, created_by)
  values (p_event, v_first, v_last, v_email, p_channel, v_price * p_qty,
          now() + make_interval(mins => greatest(coalesce(p_hold_minutes, 15), 1)), v_event.is_test, p_admin)
  returning * into v_order;

  insert into public.pass_tickets (order_id, event_id, ticket_type_id, holder_name, holder_email, profile_id, face_value, price_paid, modality)
  select v_order.id, p_event, p_type, v_first || ' ' || v_last, v_email, p_profile, v_type.price, v_price, p_modality
  from generate_series(1, p_qty);

  return jsonb_build_object(
    'order_id', v_order.id,
    'number', v_order.number,
    'access_token', v_order.access_token,
    'total', v_order.total,
    'expires_at', v_order.expires_at
  );
end;
$$;

-- ---------- Confirmar el pago y emitir las entradas ----------
-- La llama el servidor recién después de comprobar el pago contra Mercado
-- Pago (o al registrar una venta en puerta o una bonificada). Se puede
-- llamar dos veces con el mismo pago sin emitir entradas dobles.
-- Devuelve "result":
--   paid            se emitieron las entradas
--   already_paid    ya estaba paga (aviso repetido)
--   amount_mismatch el monto no coincide con el de la orden: no se emite
--   no_capacity     el pago llegó con la reserva vencida y ya no hay lugar: hay que devolverlo
--   not_payable     la orden está cancelada o reembolsada
create function public.pass_confirm_paid(
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
  -- a otra persona, así que se vuelve a comprobar la capacidad.
  if v_order.status = 'expired' or v_order.expires_at <= now() then
    select capacity into v_capacity from public.pass_events where id = v_order.event_id for update;
    select count(*) into v_qty from public.pass_tickets where order_id = p_order;
    if public.pass_taken(v_order.event_id) + v_qty > v_capacity then
      update public.pass_tickets set status = 'void' where order_id = p_order;
      update public.pass_orders
      set status = 'expired', mp_payment_id = coalesce(p_payment_id, mp_payment_id), updated_at = now()
      where id = p_order;
      return jsonb_build_object('result', 'no_capacity', 'order_id', v_order.id);
    end if;
  end if;

  update public.pass_tickets
  set status = 'valid',
      code = 'ZG-' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YY') || '-'
             || lpad(nextval('public.pass_ticket_seq')::text, 6, '0')
  where order_id = p_order;

  update public.pass_orders
  set status = 'paid', paid_at = now(), payment_method = p_method,
      mp_payment_id = coalesce(p_payment_id, mp_payment_id), updated_at = now()
  where id = p_order;

  return jsonb_build_object('result', 'paid', 'order_id', v_order.id);
end;
$$;

-- ---------- Cancelar o reembolsar una orden ----------
-- Anula las entradas que todavía no se usaron y libera sus lugares.
create function public.pass_close_order(p_order uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pass_orders%rowtype;
begin
  if p_status not in ('cancelled', 'refunded', 'expired') then raise exception 'ZG_STATUS'; end if;
  select * into v_order from public.pass_orders where id = p_order for update;
  if not found then raise exception 'ZG_NO_ORDER'; end if;
  -- Una orden paga no puede "vencer": solo cancelarse o reembolsarse.
  if p_status = 'expired' and v_order.status <> 'pending' then
    return jsonb_build_object('result', 'unchanged', 'status', v_order.status);
  end if;
  update public.pass_tickets set status = 'void' where order_id = p_order and status in ('reserved', 'valid');
  update public.pass_orders set status = p_status, updated_at = now() where id = p_order;
  return jsonb_build_object('result', 'ok', 'status', p_status);
end;
$$;

-- ---------- Limpieza de reservas vencidas ----------
-- Solo ordena los estados: los lugares ya se liberaron al vencer.
create function public.pass_expire()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with vencidas as (
    update public.pass_orders set status = 'expired', updated_at = now()
    where status = 'pending' and expires_at < now() - interval '1 hour'
    returning id
  ), anuladas as (
    update public.pass_tickets set status = 'void'
    where order_id in (select id from vencidas) and status = 'reserved'
    returning 1
  )
  select count(*) into v_count from vencidas;
  return v_count;
end;
$$;

-- ---------- Control de acceso ----------
-- Marca la entrada como utilizada solo si estaba válida, en una única
-- operación: si dos celulares leen el mismo QR a la vez, uno recibe "ok"
-- y el otro "already_used". Cada lectura queda registrada.
create function public.pass_checkin(p_token text, p_event uuid, p_admin uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.pass_tickets%rowtype;
  v_result text;
  v_first_use timestamptz;
begin
  select * into v_ticket from public.pass_tickets where token = p_token;
  if not found then
    insert into public.pass_checkins (event_id, result, admin_id) values (p_event, 'unknown', p_admin);
    return jsonb_build_object('result', 'unknown');
  end if;

  if v_ticket.event_id <> p_event then
    v_result := 'wrong_event';
  else
    update public.pass_tickets set status = 'used', used_at = now()
    where id = v_ticket.id and status = 'valid';
    if found then
      v_result := 'ok';
    else
      select status, used_at into v_ticket.status, v_first_use from public.pass_tickets where id = v_ticket.id;
      v_result := case when v_ticket.status = 'used' then 'already_used' else 'not_valid' end;
    end if;
  end if;

  insert into public.pass_checkins (ticket_id, event_id, result, admin_id)
  values (v_ticket.id, p_event, v_result, p_admin);

  return jsonb_build_object(
    'result', v_result,
    'code', v_ticket.code,
    'holder_name', v_ticket.holder_name,
    'modality', v_ticket.modality,
    'ticket_type_id', v_ticket.ticket_type_id,
    'event_id', v_ticket.event_id,
    'used_at', v_first_use
  );
end;
$$;

-- Las funciones solo las ejecuta el servidor (clave secreta), nunca una
-- cuenta del portal ni un visitante.
revoke execute on function public.pass_taken(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pass_reserve(uuid, uuid, integer, text, text, text, text, integer, numeric, text, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.pass_confirm_paid(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.pass_close_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.pass_expire() from public, anon, authenticated;
revoke execute on function public.pass_checkin(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pass_taken(uuid, uuid) to service_role;
grant execute on function public.pass_reserve(uuid, uuid, integer, text, text, text, text, integer, numeric, text, uuid, uuid, boolean) to service_role;
grant execute on function public.pass_confirm_paid(uuid, text, numeric, text) to service_role;
grant execute on function public.pass_close_order(uuid, text) to service_role;
grant execute on function public.pass_expire() to service_role;
grant execute on function public.pass_checkin(text, uuid, uuid) to service_role;

-- ---------- Primeros eventos ----------
-- El show del 24/10 queda en borrador (no se ve ni se vende) hasta que se
-- publique. El de prueba tiene 3 lugares para ensayar el "agotado".
with evento as (
  insert into public.pass_events (slug, kind, name, starts_at, venue_name, venue_address, capacity, max_per_buyer, status)
  values ('shows-open-mic-2', 'show', 'ZECHE GRUV Shows & Open Mic #2',
          '2026-10-24 20:00:00-03', 'Sergio Souza Teatro', 'Ciudad de Buenos Aires', 70, 2, 'draft')
  returning id
)
insert into public.pass_ticket_types (event_id, name, price)
select id, 'General', 8000 from evento;

with evento as (
  insert into public.pass_events (slug, kind, name, starts_at, venue_name, venue_address, capacity, max_per_buyer, status, is_test)
  values ('prueba', 'show', 'Evento de prueba', '2027-12-31 20:00:00-03', 'Lugar de prueba', 'Ciudad de Buenos Aires', 3, 2, 'published', true)
  returning id
)
insert into public.pass_ticket_types (event_id, name, price)
select id, 'General', 100 from evento;
