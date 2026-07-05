alter table if exists public.stores
  alter column commission_rate type numeric(5, 1)
  using round(commission_rate::numeric, 1);

alter table if exists public.marketplace_settings
  alter column commission_rate type numeric(7, 4)
  using round(commission_rate::numeric, 4);

alter table if exists public.settlements_v2
  alter column commission_rate type numeric(7, 4)
  using round(commission_rate::numeric, 4);
