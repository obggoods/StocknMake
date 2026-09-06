alter table public.settlements_v2
  add column if not exists inventory_applied_at timestamptz null;

drop function if exists public.create_manual_settlement_with_inventory(uuid,text,numeric,jsonb);
create or replace function public.create_manual_settlement_with_inventory(
  p_marketplace_id text,
  p_period_month text,
  p_commission_rate numeric,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_settlement_id uuid;
  v_gross numeric := 0;
  v_commission numeric;
  v_item jsonb;
  v_product_id text;
  v_qty integer;
  v_price numeric;
  v_inventory integer;
  v_shortages jsonb := '[]'::jsonb;
begin
  if v_user_id is null or p_marketplace_id is null or p_period_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid manual settlement input';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x group by (x->>'productId') having count(*) > 1) then
    raise exception 'duplicate product';
  end if;
  if not exists (select 1 from stores where id = p_marketplace_id and user_id = v_user_id) then
    raise exception 'store ownership denied';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId');
    v_qty := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unitPrice')::numeric;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_price <> trunc(v_price) then raise exception 'invalid item'; end if;
    if not exists (select 1 from products where id = v_product_id and user_id = v_user_id) then raise exception 'product ownership denied'; end if;
    v_gross := v_gross + v_qty * v_price;
  end loop;
  v_commission := round(v_gross * coalesce(p_commission_rate, 0));
  insert into settlements_v2(user_id, marketplace_id, period_month, currency, gross_amount, commission_rate, commission_amount, net_amount, rows_count, status, apply_to_inventory, source_filename, settlement_type, inventory_applied_at)
  values(v_user_id, p_marketplace_id, p_period_month, 'KRW', v_gross, coalesce(p_commission_rate,0), v_commission, v_gross-v_commission, jsonb_array_length(p_items), 'confirmed', false, null, 'detailed', now())
  returning id into v_settlement_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId');
    v_qty := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unitPrice')::numeric;
    insert into settlement_lines_v2(user_id, settlement_id, marketplace_id, product_id, product_name_raw, product_name_matched, sku_raw, qty_sold, unit_price, gross_amount, match_status)
    select v_user_id, v_settlement_id, p_marketplace_id, p.id, p.name, p.name, p.sku, v_qty, v_price, v_qty*v_price, 'matched' from products p where p.id=v_product_id and p.user_id=v_user_id;
    insert into inventory(user_id, store_id, product_id, on_hand_qty, updated_at) values(v_user_id,p_marketplace_id,v_product_id,0,now()) on conflict (user_id,store_id,product_id) do nothing;
    select on_hand_qty into v_inventory from inventory where user_id=v_user_id and store_id=p_marketplace_id and product_id=v_product_id for update;
    if v_inventory < v_qty then v_shortages := v_shortages || jsonb_build_array(jsonb_build_object('product_id',v_product_id,'before_qty',v_inventory,'sold_qty',v_qty,'shortage_qty',v_qty-v_inventory)); end if;
    update inventory set on_hand_qty=greatest(0,v_inventory-v_qty), updated_at=now() where user_id=v_user_id and store_id=p_marketplace_id and product_id=v_product_id;
  end loop;
  return jsonb_build_object('settlement_id',v_settlement_id,'shortages',v_shortages);
end;
$$;

drop function if exists public.apply_manual_settlement_inventory(uuid);
create or replace function public.apply_manual_settlement_inventory(p_settlement_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s record; l record; v_before integer; v_shortages jsonb := '[]'::jsonb;
begin
  select * into s from settlements_v2 where id=p_settlement_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'settlement not found'; end if;
  if s.settlement_type <> 'detailed' or s.source_filename is not null then raise exception 'not a manual settlement'; end if;
  if s.inventory_applied_at is not null then return jsonb_build_object('already_applied',true,'shortages',v_shortages); end if;
  for l in select product_id,qty_sold from settlement_lines_v2 where settlement_id=s.id and user_id=(select auth.uid()) loop
    insert into inventory(user_id,store_id,product_id,on_hand_qty,updated_at) values((select auth.uid()),s.marketplace_id,l.product_id,0,now()) on conflict (user_id,store_id,product_id) do nothing;
    select on_hand_qty into v_before from inventory where user_id=(select auth.uid()) and store_id=s.marketplace_id and product_id=l.product_id for update;
    if v_before < l.qty_sold then v_shortages := v_shortages || jsonb_build_array(jsonb_build_object('product_id',l.product_id,'before_qty',v_before,'sold_qty',l.qty_sold,'shortage_qty',l.qty_sold-v_before)); end if;
    update inventory set on_hand_qty=greatest(0,v_before-l.qty_sold),updated_at=now() where user_id=(select auth.uid()) and store_id=s.marketplace_id and product_id=l.product_id;
  end loop;
  update settlements_v2 set inventory_applied_at=now() where id=s.id and user_id=(select auth.uid()) and inventory_applied_at is null;
  return jsonb_build_object('already_applied',false,'shortages',v_shortages);
end; $$;

revoke all on function public.create_manual_settlement_with_inventory(text,text,numeric,jsonb) from public;
grant execute on function public.create_manual_settlement_with_inventory(text,text,numeric,jsonb) to authenticated;
revoke all on function public.apply_manual_settlement_inventory(text) from public;
grant execute on function public.apply_manual_settlement_inventory(text) to authenticated;

drop function if exists public.delete_manual_settlement(uuid);
create or replace function public.delete_manual_settlement(p_settlement_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s record; l record; v_current integer;
begin
  select * into s from settlements_v2 where id=p_settlement_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'settlement not found'; end if;
  if s.settlement_type <> 'detailed' or s.source_filename is not null then raise exception 'not a manual settlement'; end if;
  if s.inventory_applied_at is not null then
    for l in select product_id,qty_sold from settlement_lines_v2 where settlement_id=s.id and user_id=(select auth.uid()) loop
      insert into inventory(user_id,store_id,product_id,on_hand_qty,updated_at) values((select auth.uid()),s.marketplace_id,l.product_id,0,now()) on conflict (user_id,store_id,product_id) do nothing;
      select on_hand_qty into v_current from inventory where user_id=(select auth.uid()) and store_id=s.marketplace_id and product_id=l.product_id for update;
      update inventory set on_hand_qty=v_current+l.qty_sold,updated_at=now() where user_id=(select auth.uid()) and store_id=s.marketplace_id and product_id=l.product_id;
    end loop;
  end if;
  delete from settlement_lines_v2 where settlement_id=s.id and user_id=(select auth.uid());
  delete from settlements_v2 where id=s.id and user_id=(select auth.uid());
  return jsonb_build_object('inventory_restored',s.inventory_applied_at is not null);
end; $$;
revoke all on function public.delete_manual_settlement(text) from public;
grant execute on function public.delete_manual_settlement(text) to authenticated;
