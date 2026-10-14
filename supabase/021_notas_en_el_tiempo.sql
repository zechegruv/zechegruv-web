-- ZECHE GRUV — Portal de artistas
-- Notas en el tiempo exacto de la mezcla o el master. Mientras escucha, el
-- artista frena en el segundo justo y deja una nota ("acá la voz está
-- baja"); al pedir cambios, se guardan todas juntas con su minuto y
-- segundo, y a Zeche le llegan así por mail, en Notion y en el portal.
-- También queda qué archivo escuchó (version), para que cuando Zeche sube
-- una versión nueva el artista la vuelva a aprobar.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez
-- (necesita 020_aprobaciones.sql corrido antes).

alter table public.song_approvals
  add column if not exists version text check (version is null or char_length(version) <= 300),
  add column if not exists marks jsonb not null default '[]'::jsonb;

-- Hasta 60 notas por revisión, cada una { "t": segundos, "text": "…" }.
alter table public.song_approvals drop constraint if exists song_approvals_marks_check;
alter table public.song_approvals
  add constraint song_approvals_marks_check
  check (jsonb_typeof(marks) = 'array' and jsonb_array_length(marks) <= 60);
