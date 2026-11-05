-- 039 · Carpeta del master aprobado con sus versiones finales
-- (netlify/functions/_lib/masters-finales.js).
-- Una fila por canción: si ya se armó, en qué carpeta, con qué archivos,
-- de qué master aprobado y el loudness. Solo la usan las funciones del
-- servidor (clave secreta): nadie la lee desde el navegador.
create table if not exists public.masters_finales (
  song_id        text primary key,          -- id de Notion, sin guiones
  status         text not null default 'procesando' check (status in ('procesando', 'lista', 'error')),
  attempts       int  not null default 1,
  source_version text,                      -- nombre del master que aprobó el artista
  folder_url     text,                      -- link a Masters/<canción>
  files          jsonb,                     -- [{ key, label, name, size }]
  moved          jsonb,                     -- versiones anteriores que pasaron a Exports
  loudness       jsonb,                     -- { lufs, lra, truePeak, mp3Peak, source }
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

alter table public.masters_finales enable row level security;
-- Sin políticas: solo la clave secreta (service_role) lee y escribe.

-- Si ya habías corrido una versión anterior de este archivo:
alter table public.masters_finales add column if not exists moved jsonb;
