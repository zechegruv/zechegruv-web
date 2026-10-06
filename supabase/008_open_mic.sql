-- ZECHE GRUV — ZG PASS
-- Inscripción al open mic: quien ya tiene su entrada paga completa un
-- formulario y sube su canción. Una inscripción (una canción) por entrada.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

alter table public.pass_events
  add column openmic_enabled boolean not null default false,
  add column openmic_deadline timestamptz,   -- hasta cuándo se puede inscribir
  add column openmic_folder_link text;       -- link de EDICIÓN de la carpeta de OneDrive donde caen las canciones

create table public.pass_openmic (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pass_events (id) on delete restrict,
  ticket_id uuid not null unique references public.pass_tickets (id) on delete restrict,
  full_name text not null,
  aka text not null,                 -- nombre artístico con el que se presenta
  instagram text,
  email text not null,
  song_title text not null,
  tune_note text not null,           -- nota del tune (p. ej. "Do# menor") o "Sin tune"
  file_name text,                    -- nombre con el que quedó en la carpeta
  file_size bigint,
  uploaded_at timestamptz,           -- vacío: completó el formulario pero la canción no terminó de subir
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pass_openmic_event on public.pass_openmic (event_id, created_at);

-- Igual que el resto de ZG PASS: cerrada al navegador, solo el servidor.
alter table public.pass_openmic enable row level security;
revoke all on public.pass_openmic from anon, authenticated;
grant select, insert, update on public.pass_openmic to service_role;

-- Show del 24/10: open mic abierto hasta las 13:00 de ese día, y la
-- dirección del teatro.
update public.pass_events
set openmic_enabled = true,
    openmic_deadline = '2026-10-24 13:00:00-03',
    venue_address = 'Rivadavia 1180, CABA'
where slug = 'shows-open-mic-2';

update public.pass_events
set openmic_enabled = true, openmic_deadline = '2027-12-31 13:00:00-03'
where slug = 'prueba';
