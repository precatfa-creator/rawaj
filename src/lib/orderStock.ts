import type { OrderItem, OrderStatus } from '../types';

/** States whose quantities are still committed outside the shelf. */
export const statusHoldsStock = (status: OrderStatus): boolean =>
  status !== 'canceled' && status !== 'returned';

/**
 * Signed stock movement for one order-status transition.
 *
 * A new/active order already consumed stock when it was created. Canceling or
 * returning it puts every ordered unit back; reopening it consumes them again.
 * Moving between active states does not touch inventory a second time.
 */
export const stockDeltaForTransition = (
  from: OrderStatus,
  to: OrderStatus,
  items: readonly Pick<OrderItem, 'quantity'>[],
): number => {
  if (statusHoldsStock(from) === statusHoldsStock(to)) return 0;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  return statusHoldsStock(to) ? -units : units;
};
