alter table public.tv_settings
  add column if not exists drinks_items jsonb,
  add column if not exists tv_layout text not null default 'no-drinks',
  add column if not exists heat_eat_duration_seconds integer not null default 10;

alter table public.tv_settings
  drop constraint if exists tv_settings_tv_layout_check;

alter table public.tv_settings
  add constraint tv_settings_tv_layout_check
  check (tv_layout in ('no-drinks', 'drinks'));
