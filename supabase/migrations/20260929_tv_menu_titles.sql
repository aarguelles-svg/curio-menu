-- Shared editable headings for the two TV menu columns.

alter table public.tv_settings
  add column if not exists mains_title text not null default 'MAINS',
  add column if not exists heat_eat_title text not null default 'HEAT & EAT';
