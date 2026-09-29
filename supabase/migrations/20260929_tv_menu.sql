-- Curio TV menu shared media setup.
-- Run once in Supabase Dashboard > SQL Editor as the project owner.

create extension if not exists pgcrypto;

create table if not exists public.tv_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  duration_seconds integer not null default 10 check (duration_seconds between 1 and 300),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tv_settings (
  id integer primary key default 1 check (id = 1),
  qr_path text,
  updated_at timestamptz not null default now()
);

insert into public.tv_settings (id) values (1) on conflict (id) do nothing;

alter table public.tv_media enable row level security;
alter table public.tv_settings enable row level security;

revoke all on public.tv_media from anon, authenticated;
revoke all on public.tv_settings from anon, authenticated;
grant select on public.tv_media, public.tv_settings to anon;
grant select, insert, update, delete on public.tv_media to authenticated;
grant select, update on public.tv_settings to authenticated;

drop policy if exists "tv media is publicly readable" on public.tv_media;
create policy "tv media is publicly readable" on public.tv_media for select using (true);
drop policy if exists "staff can add tv media" on public.tv_media;
create policy "staff can add tv media" on public.tv_media for insert to authenticated with check (auth.uid() is not null);
drop policy if exists "staff can update tv media" on public.tv_media;
create policy "staff can update tv media" on public.tv_media for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "staff can delete tv media" on public.tv_media;
create policy "staff can delete tv media" on public.tv_media for delete to authenticated using (auth.uid() is not null);

drop policy if exists "tv settings are publicly readable" on public.tv_settings;
create policy "tv settings are publicly readable" on public.tv_settings for select using (true);
drop policy if exists "staff can update tv settings" on public.tv_settings;
create policy "staff can update tv settings" on public.tv_settings for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tv-media', 'tv-media', true, 26214400, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tv media files are publicly readable" on storage.objects;
create policy "tv media files are publicly readable" on storage.objects for select using (bucket_id = 'tv-media');
drop policy if exists "staff can upload tv media files" on storage.objects;
create policy "staff can upload tv media files" on storage.objects for insert to authenticated with check (bucket_id = 'tv-media' and auth.uid() is not null);
drop policy if exists "staff can update tv media files" on storage.objects;
create policy "staff can update tv media files" on storage.objects for update to authenticated using (bucket_id = 'tv-media' and auth.uid() is not null) with check (bucket_id = 'tv-media' and auth.uid() is not null);
drop policy if exists "staff can delete tv media files" on storage.objects;
create policy "staff can delete tv media files" on storage.objects for delete to authenticated using (bucket_id = 'tv-media' and auth.uid() is not null);
