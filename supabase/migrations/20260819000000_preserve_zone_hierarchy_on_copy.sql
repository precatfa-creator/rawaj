-- A store copy must retain the catalogue row's Libya hierarchy.
--
-- The copy-on-write function predates the city/scope/municipality columns. Its
-- old explicit column list still worked, but silently reset the new metadata to
-- defaults whenever a store edited or disabled a shared zone.
create or replace function public.zone_for_store(p_zone_id text, p_store_id text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_zone public.delivery_zones;
  v_existing text;
  v_new_id text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if coalesce(p_store_id, '') = '' then
    raise exception 'NO_STORE';
  end if;

  select * into v_zone from public.delivery_zones where id = p_zone_id;
  if not found then
    raise exception 'NO_SUCH_ZONE';
  end if;

  if v_zone.store_id is not null then
    if v_zone.store_id <> p_store_id then
      raise exception 'OTHER_STORE_ZONE';
    end if;
    return v_zone.id;
  end if;

  select id into v_existing from public.delivery_zones
  where store_id = p_store_id and source_id = v_zone.id;
  if found then
    return v_existing;
  end if;

  v_new_id := gen_random_uuid()::text;
  insert into public.delivery_zones (
    id, code, name, region, capital, area_km2, fee, delivery_time_days, active,
    commission_type, commission_value, city, scope, municipality, alt_name,
    lat, lon, needs_translation, source, store_id, source_id
  )
  values (
    v_new_id, v_zone.code, v_zone.name, v_zone.region, v_zone.capital, v_zone.area_km2,
    v_zone.fee, v_zone.delivery_time_days, v_zone.active, v_zone.commission_type,
    v_zone.commission_value, v_zone.city, v_zone.scope, v_zone.municipality,
    v_zone.alt_name, v_zone.lat, v_zone.lon, v_zone.needs_translation, v_zone.source,
    p_store_id, v_zone.id
  );

  return v_new_id;
end;
$$;

grant execute on function public.zone_for_store(text, text) to authenticated;
