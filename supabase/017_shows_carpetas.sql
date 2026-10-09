-- ZECHE GRUV — ZG PASS · Shows desde el portal y carpetas por edición
--   · Carpeta madre: se pega UNA vez (ZG PASS → Carpetas). Cada show arma
--     solo, adentro, su carpeta de edición con "Open Mic" y "Shows" (y en
--     Shows, una carpeta por artista). Si un evento tiene links propios
--     (openmic_folder_link / shows_folder_link), se usan esos.
--   · Crear y editar shows desde el portal (ZG PASS → "Crear show").
--   · Aviso por mail a los artistas del sello cuando se los suma al line up.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

-- Ajustes generales de ZG PASS (por ahora, la carpeta madre).
create table if not exists public.pass_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.pass_settings enable row level security;
revoke all on public.pass_settings from anon, authenticated;
grant select, insert, update on public.pass_settings to service_role;

-- Nombre de la carpeta de cada edición, adentro de la carpeta madre.
alter table public.pass_events add column if not exists folder_name text;

-- Cuándo se le avisó por mail a cada artista del sello (una sola vez).
alter table public.pass_show_artists add column if not exists notified_at timestamptz;

-- Flyers de los eventos: públicos (se ven en la página de entradas), solo
-- los sube el administrador. JPG, PNG o WebP, hasta 5 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('events', 'events', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "flyers de eventos: sube el admin" on storage.objects;
create policy "flyers de eventos: sube el admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'events' and public.is_admin());

-- Acceso de puerta: link único por persona y por evento (zechegruv.com/puerta?k=…)
-- con el scanner, la venta en puerta y el contador. Sin cuenta y sin acceso
-- al resto del portal. Vence 24 h después del evento; se puede dar de baja.
create table if not exists public.pass_door_access (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pass_events (id) on delete cascade,
  label text not null,                   -- quién está en la puerta
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists pass_door_access_event on public.pass_door_access (event_id);
alter table public.pass_door_access enable row level security;
revoke all on public.pass_door_access from anon, authenticated;
grant select, insert, update on public.pass_door_access to service_role;
