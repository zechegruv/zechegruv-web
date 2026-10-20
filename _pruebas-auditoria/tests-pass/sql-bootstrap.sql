-- Lo mínimo de Supabase para correr las migraciones de ZG PASS en un Postgres local.
create role anon; create role authenticated; create role service_role;
create table public.profiles (id uuid primary key default gen_random_uuid(), role text, name text, display_name text, email text);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function public.is_admin() returns boolean language sql as $$ select false $$;
