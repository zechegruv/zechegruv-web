-- ZECHE GRUV — Portal: revisión de lanzamientos y conexión con ZIL.
-- - review_note: lo que ZECHE GRUV le pide corregir al artista cuando le
--   devuelve el lanzamiento (vuelve a "Borrador" con esta nota).
-- - zil_*: datos del lanzamiento en la distribuidora ZIL una vez que lo
--   publicás desde el panel (proyecto, lanzamiento, estado en cada tienda
--   y el link único con todas las tiendas).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.releases
  add column if not exists review_note text,
  add column if not exists zil_project_id text,
  add column if not exists zil_album_id text,
  add column if not exists zil_status jsonb,
  add column if not exists smart_link text,
  add column if not exists sent_to_stores_at timestamptz;

notify pgrst, 'reload schema';
