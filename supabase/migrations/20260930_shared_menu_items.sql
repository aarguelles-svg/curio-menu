-- Persist the two menu columns. Mains is shared with the Instagram Story generator.

alter table public.tv_settings
  add column if not exists mains_items jsonb,
  add column if not exists heat_eat_items jsonb;
