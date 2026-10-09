-- ZECHE GRUV — ZG PASS · Pistas de los shows
-- Quienes tocan en un evento suben sus pistas y llegan a la carpeta "Shows"
-- del evento en OneDrive, en una subcarpeta con su nombre (se crea sola).
--   · Artistas del sello: desde su portal (tarjeta "Tu show").
--   · Invitados sin cuenta (p. ej. quien ganó su lugar en el open mic):
--     con un link único, zechegruv.com/pistas?k=…, sin usuario ni contraseña.
--     Sube, igual que los artistas, a la carpeta con su nombre dentro de
--     Shows (o a otra, si se pega su link). El link vence 24 h después del show.
-- Los links de las carpetas (Open mic y Shows), quién toca y los invitados
-- se manejan desde el portal: ZG PASS → pestaña "Carpetas".
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.pass_events
  add column if not exists shows_folder_link text,      -- link de EDICIÓN de la carpeta Shows del evento
  add column if not exists shows_deadline timestamptz;  -- hasta cuándo se suben pistas; vacío: hasta la hora del evento

-- Artistas del sello que tocan en cada evento.
create table if not exists public.pass_show_artists (
  event_id uuid not null references public.pass_events (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

-- Invitados sin cuenta en el portal: entran con su link único.
create table if not exists public.pass_show_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pass_events (id) on delete cascade,
  name text not null,                    -- nombre artístico (y de su carpeta dentro de Shows)
  email text,
  folder_link text,                      -- opcional: link de EDICIÓN de una carpeta propia fuera de Shows
  gift_session boolean not null default false, -- su página le regala una sesión de 2 h en el estudio
  plural boolean not null default false,       -- dúo o banda: la página les habla en plural
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz                 -- con fecha: el link deja de andar
);
create index if not exists pass_show_guests_event on public.pass_show_guests (event_id);
-- Por si la tabla ya se había creado con la versión anterior de este archivo:
alter table public.pass_show_guests
  add column if not exists folder_link text,
  add column if not exists gift_session boolean not null default false,
  add column if not exists plural boolean not null default false;

-- Pistas que ya terminaron de subir (de un artista o de un invitado).
create table if not exists public.pass_show_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pass_events (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  guest_id uuid references public.pass_show_guests (id) on delete cascade,
  file_name text not null,               -- nombre con el que quedó en la carpeta
  file_size bigint,
  uploaded_at timestamptz not null default now(),
  check (num_nonnulls(profile_id, guest_id) = 1)
);
create index if not exists pass_show_files_event on public.pass_show_files (event_id, uploaded_at);

-- Igual que el resto de ZG PASS: cerradas al navegador, solo el servidor.
alter table public.pass_show_artists enable row level security;
alter table public.pass_show_guests enable row level security;
alter table public.pass_show_files enable row level security;
revoke all on public.pass_show_artists, public.pass_show_guests, public.pass_show_files from anon, authenticated;
grant select, insert, update, delete on public.pass_show_artists to service_role;
grant select, insert, update on public.pass_show_guests to service_role;
grant select, insert on public.pass_show_files to service_role;

-- ---------- Show del 24/10 ----------
-- Pistas hasta el mismo sábado a las 13:00.
update public.pass_events
set shows_deadline = '2026-10-24 13:00:00-03'
where slug = 'shows-open-mic-2';

-- Los del line up con cuenta en el portal (mismo nombre artístico). Los
-- invitados (p. ej. Bastian & Kaino) se crean desde el portal pegando el
-- link de su carpeta.
insert into public.pass_show_artists (event_id, profile_id)
select ev.id, p.id
from public.pass_events ev
join public.profiles p
  on p.role = 'artist' and lower(trim(p.display_name)) in (select lower(trim(x)) from unnest(ev.lineup) as x)
where ev.slug = 'shows-open-mic-2'
on conflict do nothing;

-- Cómo quedó.
select p.display_name as toca_en_el_show
from public.pass_show_artists sa
join public.pass_events ev on ev.id = sa.event_id
join public.profiles p on p.id = sa.profile_id
where ev.slug = 'shows-open-mic-2';
