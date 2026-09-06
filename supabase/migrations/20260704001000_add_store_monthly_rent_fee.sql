alter table if exists public.stores
  add column if not exists monthly_rent_fee numeric not null default 0,
  add column if not exists include_monthly_rent_in_margin boolean not null default true;

update public.stores
set
  monthly_rent_fee = coalesce(monthly_rent_fee, 0),
  include_monthly_rent_in_margin = coalesce(include_monthly_rent_in_margin, true);

alter table if exists public.stores
  alter column monthly_rent_fee set default 0,
  alter column monthly_rent_fee set not null,
  alter column include_monthly_rent_in_margin set default true,
  alter column include_monthly_rent_in_margin set not null;

alter table if exists public.stores
  drop constraint if exists stores_monthly_rent_fee_non_negative;

alter table if exists public.stores
  add constraint stores_monthly_rent_fee_non_negative
  check (monthly_rent_fee >= 0);
