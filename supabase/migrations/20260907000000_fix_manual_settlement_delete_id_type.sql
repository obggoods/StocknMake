drop function if exists public.delete_manual_settlement(text);

create or replace function public.delete_manual_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  l record;
  v_current integer;
begin
  select * into s
  from settlements_v2
  where id = p_settlement_id
    and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'settlement not found'; end if;
  if s.settlement_type <> 'detailed' or s.source_filename is not null then
    raise exception 'not a manual settlement';
  end if;

  if s.inventory_applied_at is not null then
    for l in
      select product_id, qty_sold
      from settlement_lines_v2
      where settlement_id = s.id
        and user_id = (select auth.uid())
    loop
      insert into inventory(user_id, store_id, product_id, on_hand_qty, updated_at)
      values ((select auth.uid()), s.marketplace_id, l.product_id, 0, now())
      on conflict (user_id, store_id, product_id) do nothing;

      select on_hand_qty into v_current
      from inventory
      where user_id = (select auth.uid())
        and store_id = s.marketplace_id
        and product_id = l.product_id
      for update;

      update inventory
      set on_hand_qty = v_current + l.qty_sold, updated_at = now()
      where user_id = (select auth.uid())
        and store_id = s.marketplace_id
        and product_id = l.product_id;
    end loop;
  end if;

  delete from settlement_lines_v2
  where settlement_id = s.id and user_id = (select auth.uid());
  delete from settlements_v2
  where id = s.id and user_id = (select auth.uid());

  return jsonb_build_object('inventory_restored', s.inventory_applied_at is not null);
end;
$$;

revoke all on function public.delete_manual_settlement(uuid) from public;
grant execute on function public.delete_manual_settlement(uuid) to authenticated;
