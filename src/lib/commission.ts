import type { DeliveryZone, SalesRep } from '../types';

/**
 * What one delivered order pays its rep.
 *
 * The cut comes out of the delivery fee the order actually charged, not out of
 * the goods: a zone either takes a percentage of that fee, pays a flat amount
 * per order, or says nothing — in which case the rep's own flat commission
 * applies. An order with no zone is the same "says nothing" case.
 *
 * Mirrors public.order_commission in
 * 20260814100000_order_edit_zone_commission.sql; commission.check.ts asserts
 * the two agree on the same fixtures.
 */
export const orderCommission = (
  deliveryFee: number,
  zone: Pick<DeliveryZone, 'commissionType' | 'commissionValue'> | undefined,
  repCommission: number,
): number => {
  if (zone?.commissionType === 'percent') return (deliveryFee || 0) * (zone.commissionValue || 0) / 100;
  if (zone?.commissionType === 'fixed') return zone.commissionValue || 0;
  return repCommission || 0;
};

/** Human-readable rule for a zone, for the zones page and the rep cards. */
export const describeCommission = (zone: Pick<DeliveryZone, 'commissionType' | 'commissionValue'>): string => {
  if (zone.commissionType === 'percent') return `${zone.commissionValue}% من رسوم التوصيل`;
  if (zone.commissionType === 'fixed') return `${Math.round(zone.commissionValue).toLocaleString('en-US')} د.ل لكل طلب`;
  return 'عمولة المندوب الثابتة';
};

/** Empty list means the rep covers every zone. */
export const repCoversZone = (rep: Pick<SalesRep, 'zones'>, zoneName: string): boolean =>
  rep.zones.length === 0 || !zoneName || rep.zones.includes(zoneName);

/**
 * The reps an order in this zone may actually be handed to.
 *
 * Coverage is a rule, not a preference: a rep who does not serve the zone is
 * not offered, because that pairing is a delivery nobody makes. An order with
 * no zone yet constrains nothing — there is no zone to contradict.
 *
 * `keepId` keeps whoever is already assigned in the list even when they no
 * longer cover the zone. Rows predate this rule, and a rep's zones can be
 * edited afterwards; dropping them would blank the field and hide the bad
 * pairing instead of showing it to be corrected.
 */
export const assignableReps = <T extends Pick<SalesRep, 'id' | 'zones' | 'active'>>(
  reps: readonly T[],
  zoneName: string,
  keepId?: string,
): T[] =>
  reps.filter(rep => (rep.active && repCoversZone(rep, zoneName)) || (!!keepId && rep.id === keepId));
