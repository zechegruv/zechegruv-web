-- ZECHE GRUV — Panel de administrador: checklist de modificaciones sin perder tildes.
-- En el Inicio, cuando un artista pide modificaciones, cada una se tilda
-- a medida que la resolvés. Antes cada clic leía la lista, le cambiaba una
-- cosa y la escribía entera: con dos clics rápidos, el segundo pisaba al
-- primero y se perdía un tilde. Esta función hace el cambio de una sola vez
-- adentro de la base (bloqueando esa fila mientras tanto), así no se pisan.
-- La usa netlify/functions/portal-reviews.js; si todavía no la corriste,
-- el panel sigue funcionando como antes.
-- Solo las functions (clave secreta) la pueden usar: el navegador no.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez
-- (necesita 025_automatizaciones.sql corrido antes).

create or replace function public.zg_toggle_resolved(p_id uuid, p_i int, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marks    jsonb;
  v_resolved jsonb;
  v_n        int;
begin
  -- La fila queda bloqueada hasta terminar: otro clic espera su turno.
  select marks, resolved into v_marks, v_resolved
    from public.song_approvals
   where id = p_id
     for update;
  if not found then
    return null; -- no existe esa revisión
  end if;

  v_n := case when jsonb_typeof(v_marks) = 'array' then jsonb_array_length(v_marks) else 0 end;
  if jsonb_typeof(v_resolved) is distinct from 'array' then
    v_resolved := '[]'::jsonb;
  end if;

  -- Lo que ya estaba tildado (sin la nota p_i), más p_i si se tildó;
  -- solo números de notas que existen, sin repetir y en orden.
  select coalesce(jsonb_agg(to_jsonb(x) order by x), '[]'::jsonb)
    into v_resolved
    from (
      select distinct x
        from (
          select (e)::int as x
            from jsonb_array_elements_text(v_resolved) as e
           where e ~ '^\d+$' and (e)::int <> p_i
          union
          select p_i where p_done
        ) a
       where x >= 0 and x < v_n
    ) b;

  update public.song_approvals set resolved = v_resolved where id = p_id;
  return v_resolved;
end;
$$;

revoke all on function public.zg_toggle_resolved(uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.zg_toggle_resolved(uuid, int, boolean) to service_role;

notify pgrst, 'reload schema';
