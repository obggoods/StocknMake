alter table public.products
  add column if not exists headquarters_stock_qty integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_headquarters_stock_qty_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_headquarters_stock_qty_nonnegative
      check (headquarters_stock_qty >= 0)
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'products_headquarters_stock_qty_nonnegative'
      and conrelid = 'public.products'::regclass
      and not convalidated
  ) then
    alter table public.products
      validate constraint products_headquarters_stock_qty_nonnegative;
  end if;
end $$;
