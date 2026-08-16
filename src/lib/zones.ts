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
  areaKm2: Number(row.area_km2 ?? 0),
  fee: Number(row.fee ?? 0),
  deliveryTimeDays: Number(row.delivery_time_days ?? 0),
  active: Boolean(row.active),
  commissionType: (row.commission_type as DeliveryZone['commissionType']) ?? 'none',
  commissionValue: Number(row.commission_value ?? 0),
  storeId: (row.store_id as string | null) ?? null,
  sourceId: (row.source_id as string | null) ?? null,
  cityId: (row.city_id as string | null) ?? null,
  city: (row.city as string) ?? '',
  scopeId: (row.scope_id as string | null) ?? null,
  scope: (row.scope as string) ?? '',
  municipalityId: (row.municipality_id as string | null) ?? null,
  municipality: (row.municipality as string) ?? '',
  altName: (row.alt_name as string) ?? '',
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lon: row.lon === null || row.lon === undefined ? null : Number(row.lon),
  needsTranslation: Boolean(row.needs_translation),
  source: (row.source as string) ?? '',
});

export const byCode = (a: DeliveryZone, b: DeliveryZone) => a.code.localeCompare(b.code);

/** المدينة ← النطاق ← المناطق, for the tree view and the city/scope pickers. */
export interface CityNode {
  city: string;
  zones: DeliveryZone[];
  scopes: {
    scope: string;
    zones: DeliveryZone[];
    municipalities: { municipality: string; zones: DeliveryZone[] }[];
  }[];
}

export const groupByCity = (zones: DeliveryZone[]): CityNode[] => {
  const cities = new Map<string, Map<string, Map<string, DeliveryZone[]>>>();
  zones.forEach(zone => {
    // Rows added by hand before the hierarchy existed have no city; they are
    // still real zones, so they get a bucket rather than disappearing.
    const city = zone.city || 'بدون مدينة';
    const scope = zone.scope || 'بدون نطاق';
    const municipality = zone.municipality || 'بدون بلدية';
    if (!cities.has(city)) cities.set(city, new Map());
    const scopes = cities.get(city)!;
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    const municipalities = scopes.get(scope)!;
    if (!municipalities.has(municipality)) municipalities.set(municipality, []);
    municipalities.get(municipality)!.push(zone);
  });

  return [...cities.entries()]
    .map(([city, scopes]) => ({
      city,
      zones: [...scopes.values()].flatMap(municipalities => [...municipalities.values()]).flat().sort(byCode),
      scopes: [...scopes.entries()]
        .map(([scope, municipalities]) => ({
          scope,
          zones: [...municipalities.values()].flat().sort(byCode),
          municipalities: [...municipalities.entries()]
            .map(([municipality, list]) => ({ municipality, zones: [...list].sort(byCode) }))
            .sort((a, b) => a.municipality.localeCompare(b.municipality, 'ar')),
        }))
        .sort((a, b) => a.scope.localeCompare(b.scope, 'ar')),
    }))
    .sort((a, b) => b.zones.length - a.zones.length || a.city.localeCompare(b.city, 'ar'));
};
