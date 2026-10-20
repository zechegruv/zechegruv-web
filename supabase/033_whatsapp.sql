-- ZECHE GRUV — Portal: avisos por WhatsApp.
-- Cuando la mezcla o el master de un artista está listo (o las
-- modificaciones que pidió), además del mail le llega un WhatsApp
-- (netlify/functions/_lib/whatsapp.js, ver docs/WHATSAPP.md). Cada artista
-- lo puede apagar desde su Perfil, con el interruptor "Avisos por WhatsApp".
-- Viene prendido para todos.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.profiles
  add column if not exists whatsapp_avisos boolean not null default true;

-- El propio artista lo puede cambiar. El control de cambios del perfil
-- (profiles_guard, la última versión está en 013_activos.sql) solo vuelve a
-- su valor anterior las columnas que el artista no puede tocar: id, role,
-- email, full_name, spotify_artist_id, apple_id, format, active y
-- created_at (y distributes, con su propio control en 028_distribuye.sql).
-- whatsapp_avisos no está en esa lista, así que no hace falta cambiar nada:
-- se deja el control tal como está.

notify pgrst, 'reload schema';
