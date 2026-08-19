import type { Order, OrderStatus } from '../types';

/**
 * The delivery journey, as a line the customer can be walked along.
 *
 * Only five of the seven statuses are stages of one trip: `canceled` and
 * `returned` are ways for that trip to stop, not places along it, so they are
 * reported separately rather than tacked on as a sixth and seventh circle.
 */
export const TRACK_STEPS: Array<{ status: OrderStatus; label: string }> = [
  { status: 'new', label: 'طلب شحن' },
  { status: 'confirmed', label: 'تم التأكيد' },
  { status: 'processing', label: 'قيد التجهيز' },
  { status: 'shipped', label: 'قيد التوصيل' },
  { status: 'delivered', label: 'تم التسليم' },
];

export interface TrackState {
  /** Index into `TRACK_STEPS` of the furthest stage reached, 0-based. */
  index: number;
  /** Null while the order is still moving. */
  halted: 'canceled' | 'returned' | null;
  /**
   * True while the order is parked mid-trip. Not a halt: the goods are still
   * out and the money is still expected, so the ladder keeps its position and
   * only the marker says the trip is paused.
   */
  held: boolean;
}

/**
 * Where the order sits on the line.
 *
 * Derived from the current status alone — the orders table keeps one status,
 * not a history, so there are no per-step timestamps to show and no way to know
 * which stages a canceled order actually passed through. That gives the two
 * halted cases their positions: a return can only follow a delivery, so it
 * keeps the line full; a cancellation can happen at any point, so the line is
 * drawn from the start and the banner carries the real news.
 */
export const trackingState = (status: OrderStatus): TrackState => {
  if (status === 'returned') return { index: TRACK_STEPS.length - 1, halted: 'returned', held: false };
  if (status === 'canceled') return { index: 0, halted: 'canceled', held: false };

  // A hold sits where the order already got to — out for delivery — rather than
  // adding a rung every order would appear to have passed through.
  if (status === 'waiting') {
    return { index: TRACK_STEPS.findIndex(step => step.status === 'shipped'), halted: null, held: true };
  }

  // A partial delivery is still an arrival: the trip finished, and what it
  // earned is a question for the lines, not for the ladder.
  if (status === 'delivered_partial') {
    return { index: TRACK_STEPS.length - 1, halted: null, held: false };
  }

  const index = TRACK_STEPS.findIndex(step => step.status === status);
  // An unknown status is treated as the beginning rather than crashing the
  // details view: the badge beside it still prints whatever the row says.
  return { index: index === -1 ? 0 : index, halted: null, held: false };
};

/**
 * The moment each stage was last reached, keyed by status.
 *
 * Last, not first. An order sent back to a stage it already passed is on a new
 * trip: showing the first time it was confirmed means a status changed just now
 * still reads with a timestamp from days ago. Events arrive oldest first, so a
 * later entry for the same status overwrites the earlier one.
 */
export const latestMoments = <T extends { status: string }>(events: readonly T[]): Map<string, T> => {
  const moments = new Map<string, T>();
  events.forEach(event => moments.set(event.status, event));
  return moments;
};

/**
 * The explicit date on the order wins. Otherwise the zone's delivery duration
 * gives the operator a useful ETA instead of an unexplained "not specified".
 * UTC calendar arithmetic keeps a date-only value from shifting a day when the
 * browser and server use different time zones.
 */
export const estimatedDeliveryDate = (
  order: Pick<Order, 'createdAt' | 'deliveryDate'>,
  deliveryTimeDays?: number,
): string | null => {
  if (order.deliveryDate) return order.deliveryDate;
  if (deliveryTimeDays === undefined || !Number.isFinite(deliveryTimeDays)) return null;

  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  created.setUTCDate(created.getUTCDate() + Math.max(0, Math.round(deliveryTimeDays)));
  return created.toISOString().slice(0, 10);
};
