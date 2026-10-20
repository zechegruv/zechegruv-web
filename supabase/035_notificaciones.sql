-- ZECHE GRUV — Portal: notificaciones en el celu y en la compu.
-- Con el portal instalado (o abierto en Chrome, Edge o Safari), al artista
-- le llega una notificación con el logo del sello, igual que en cualquier
-- app. Dos tipos, que cada uno prende o apaga en su portal:
--   · Tu proyecto (notif_proyecto): mezcla lista, master listo,
--     modificaciones listas, recordatorio y nueva fecha de entrega.
--   · Eventos (notif_novedades): invitación a cantar en el open mic (a quien
--     no está en el line up) y aviso el día del show (a quien toca).
-- De 00 a 9 h no sale nada: lo de la noche llega a las 9.
-- Lo usan netlify/functions/_lib/push.js y portal-push.js.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

-- Lo que elige cada artista (vale para todos sus dispositivos). El control
-- de cambios del perfil (profiles_guard) no protege estas columnas: el
-- propio artista las puede cambiar.
alter table public.profiles
  add column if not exists notif_proyecto boolean not null default true,
  add column if not exists notif_novedades boolean not null default true;

-- Cada dispositivo donde el artista activó las notificaciones.
create table if not exists public.push_subscriptions (
  endpoint    text primary key,                 -- dirección que da el navegador (única por dispositivo)
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  p256dh      text not null,                    -- claves del navegador para cifrar el aviso
  auth        text not null,
  device      text,                             -- "iPhone", "Android", "Mac"… (solo para mostrar)
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz                       -- último aviso que llegó bien
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);

-- Cola de avisos: una fila por aviso y artista. La clave ("key") evita
-- mandar dos veces lo mismo; "not_before" guarda los que caen en el horario
-- de silencio hasta las 9.
create table if not exists public.push_queue (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  category    text not null check (category in ('proyecto', 'novedades')),
  title       text not null,
  body        text not null,
  url         text not null default '/portal/',
  tag         text,
  not_before  timestamptz not null default now(),
  sent_at     timestamptz,                       -- vacío: todavía no salió
  result      text,                              -- "ok 2/2", "sin dispositivos", "vencido"…
  created_at  timestamptz not null default now()
);
create index if not exists push_queue_pending on public.push_queue (not_before) where sent_at is null;
create index if not exists push_queue_profile on public.push_queue (profile_id, category, created_at desc);

-- Cerradas al navegador: solo las functions (clave secreta) leen y escriben.
alter table public.push_subscriptions enable row level security;
alter table public.push_queue enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.push_queue from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.push_queue to service_role;

notify pgrst, 'reload schema';
