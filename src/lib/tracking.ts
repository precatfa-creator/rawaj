import type { OrderStatus } from '../types';

/**
 * The delivery journey, as a line the customer can be walked along.
 *
 * Only five of the seven statuses are stages of one trip: `canceled` and
 * `returned` are ways for that trip to stop, not places along it, so they are
 * reported separately rather than tacked on as a sixth and seventh circle.
 */
export const TRACK_STEPS: Array<{ status: OrderStatus; label: string }> = [
  { status: 'new', label: 'طلب جديد' },
  { status: 'confirmed', label: 'تم التأكيد' },
  { status: 'processing', label: 'قيد التجهيز' },
  { status: 'shipped', label: 'قيد الشحن' },
  { status: 'delivered', label: 'تم التسليم' },
];

export interface TrackState {
  /** Index into `TRACK_STEPS` of the furthest stage reached, 0-based. */
  index: number;
  /** Null while the order is still moving. */
  halted: 'canceled' | 'returned' | null;
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
  if (status === 'returned') return { index: TRACK_STEPS.length - 1, halted: 'returned' };
  if (status === 'canceled') return { index: 0, halted: 'canceled' };
  const index = TRACK_STEPS.findIndex(step => step.status === status);
  // An unknown status is treated as the beginning rather than crashing the
  // details view: the badge beside it still prints whatever the row says.
  return { index: index === -1 ? 0 : index, halted: null };
};
