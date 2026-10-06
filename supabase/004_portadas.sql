-- ZECHE GRUV — Portal de artistas
-- Portadas de los lanzamientos: archivos privados (JPG o PNG, hasta 20 MB).
-- Cada artista sube y ve solo las suyas; el administrador, todas. No hay
-- permiso de borrado ni de reemplazo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 20971520, array['image/jpeg', 'image/png']);

create policy "subir portada propia"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

create policy "ver portada propia o todas si es admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'covers' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
