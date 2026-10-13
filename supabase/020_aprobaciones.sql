-- ZECHE GRUV — Portal de artistas
-- Aprobaciones de mezcla y master. Cuando el artista escucha la mezcla o el
-- master de una canción, desde "Canciones" la aprueba o pide cambios (con
-- una nota). Queda guardado acá, a Zeche le llega un mail y en la ficha de
-- la canción en Notion aparece un comentario.
-- Solo leen y escriben las functions (portal-review.js y portal-songs.js)
-- con la clave secreta: el navegador no tiene acceso directo.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

create table if not exists public.song_approvals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  song_id text not null,                       -- id de la canción en Notion
  song_title text not null,
  kind text not null check (kind in ('mezcla', 'master')),
  action text not null check (action in ('aprobada', 'cambios')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists song_approvals_profile_song on public.song_approvals (profile_id, song_id, created_at desc);

alter table public.song_approvals enable row level security;
-- Sin políticas: nadie la lee ni la escribe desde el navegador.
