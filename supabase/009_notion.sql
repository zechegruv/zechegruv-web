-- ZECHE GRUV — Portal de artistas
-- "Tus canciones": la ficha de cada artista en Notion (base Clientes Zeche
-- Gruv). Con ella netlify/functions/portal-songs.js busca sus canciones en
-- la base Canciones y el portal muestra en qué etapa está cada una.
-- Igual que los links de OneDrive, la ve únicamente el administrador.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.
alter table public.artist_private add column notion_page_id text;
