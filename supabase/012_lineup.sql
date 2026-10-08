-- ZG PASS · Line up propio de cada evento.
-- Se muestra en la página del evento, en la entrada digital y en el mail.
-- Correr en Supabase > SQL Editor. Se puede correr más de una vez.
alter table public.pass_events add column if not exists lineup text[];

-- Show del 24/10: el line up pasa a su campo y sale de la descripción,
-- para que no se repita en la página.
update public.pass_events
set lineup = array['Pazz', 'Maki', 'Bastian & Kaino', 'Rouse Bby'],
    description = 'Cuatro shows de artistas del sello en una sola noche, '
               || 'y un open mic para que tu canción también suene.'
where slug = 'shows-open-mic-2';

select name, lineup, description from public.pass_events where slug = 'shows-open-mic-2';
