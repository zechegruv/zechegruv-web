-- ZECHE GRUV — Portal de artistas
-- La ficha de Notion de cada artista queda fija apenas se encuentra.
-- netlify/functions/portal-songs.js busca la ficha de Clientes Zeche Gruv
-- por el mail o por el nombre completo del artista (los dos los carga solo
-- el administrador; nunca por el nombre que el artista edita en su perfil)
-- y la guarda en artist_private.notion_page_id. Para eso el servidor
-- (service_role) necesita poder escribir esa tabla: hasta ahora solo la leía.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.
grant insert, update on public.artist_private to service_role;
