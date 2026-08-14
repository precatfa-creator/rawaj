import type { DeliveryZone } from '../types';

/**
 * A zone row as `store_zones` returns it.
 *
 * The RPC returns the table's own columns, so the names are snake_case and the
 * numerics arrive as strings — unlike a PostgREST select, which can alias and
 * coerce on the way out. One converter, used by the store and by the exporter,
 * so the two cannot disagree about what a fee is.
 */
export const zoneFromRow = (row: Record<string, unknown>): DeliveryZone => ({
  id: row.id as string,
  code: (row.code as string) ?? '',
  name: (row.name as string) ?? '',
  region: row.region as DeliveryZone['region'],
  capital: (row.capital as string) ?? '',
  areaKm2: Number(row.area_km2 ?? 0),
  fee: Number(row.fee ?? 0),
  deliveryTimeDays: Number(row.delivery_time_days ?? 0),
  active: Boolean(row.active),
  commissionType: (row.commission_type as DeliveryZone['commissionType']) ?? 'none',
  commissionValue: Number(row.commission_value ?? 0),
  storeId: (row.store_id as string | null) ?? null,
  sourceId: (row.source_id as string | null) ?? null,
});

export const byCode = (a: DeliveryZone, b: DeliveryZone) => a.code.localeCompare(b.code);
