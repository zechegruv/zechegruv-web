-- ZECHE GRUV — Portal de artistas
-- La ficha de Notion de cada artista queda fija apenas se encuentra.
-- netlify/functions/portal-songs.js busca la ficha de Clientes Zeche Gruv
-- por el mail o por el nombre completo del artista (los dos los carga solo
-- el administrador; nunca por el nombre que el artista edita en su perfil)
-- y la guarda en artist_private.notion_page_id. Para eso el servidor
-- (service_role) necesita poder escribir esa tabla: hasta ahora solo la leía.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.
grant insert, update on public.artist_private to service_role;

-- Notas de voz: al borrar una nota de voz que todavía no mandó, el artista
-- borra también su audio (revision.js), así no quedan audios sueltos. Solo
-- los suyos y solo si no forman parte de un pedido ya enviado (esos los
-- sigue escuchando Zeche).
create or replace function public.nota_de_voz_enviada(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.song_approvals a
    where a.marks @> jsonb_build_array(jsonb_build_object('voice', p_name))
  );
$$;
revoke all on function public.nota_de_voz_enviada(text) from public;
grant execute on function public.nota_de_voz_enviada(text) to authenticated;

drop policy if exists "borrar nota de voz propia sin mandar" on storage.objects;
create policy "borrar nota de voz propia sin mandar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'notas-voz'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.nota_de_voz_enviada(name)
  );
