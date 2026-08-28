import type { Order, OrderItem } from '../types';

/** subtotal = Σ price×qty; total = subtotal − discount + delivery, never below 0. */
export const orderTotals = (items: OrderItem[], discount: number, deliveryFee: number) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { subtotal, total: Math.max(0, subtotal - discount + deliveryFee) };
};

/**
 * Units that reached the customer on a line.
 *
 * Absent means all of them: that is what a line written before partial delivery
 * existed means, and what a full delivery still means. Clamped to the ordered
 * quantity so a bad value can never invent revenue, and floored at zero.
 */
export const deliveredOf = (item: OrderItem): number =>
  item.deliveredQuantity === undefined
    ? item.quantity
    : Math.max(0, Math.min(item.quantity, item.deliveredQuantity));

export const orderedUnits = (items: OrderItem[]): number =>
  items.reduce((sum, item) => sum + item.quantity, 0);

export const deliveredUnits = (items: OrderItem[]): number =>
  items.reduce((sum, item) => sum + deliveredOf(item), 0);

/** True once any line arrived short — what makes an order a partial delivery. */
export const isShort = (items: OrderItem[]): boolean =>
  items.some(item => deliveredOf(item) < item.quantity);

/**
 * What a partly delivered order earned.
 *
 * The lines are counted at what actually arrived. The delivery fee is kept
 * whole, because the trip was made either way, and the discount is prorated by
 * the delivered share of the goods so a 10% discount stays 10% instead of
 * becoming a deeper cut of a smaller sale.
 *
 * ponytail: proration is a policy, not arithmetic — if the business decides a
 * discount applies whole, or not at all, this is the one line to change.
 */
export const deliveredTotals = (items: OrderItem[], discount: number, deliveryFee: number) => {
  const ordered = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * deliveredOf(item), 0);
  const share = ordered === 0 ? 0 : subtotal / ordered;
  return { subtotal, total: Math.max(0, subtotal - discount * share + deliveryFee) };
};

/**
 * What an order is actually worth right now.
 *
 * `total` is what was ordered, and it stays that way: the stored columns are
 * the agreement, and prorating the discount into them would destroy the figure
 * the operator typed. Only a partly delivered order reads differently, and only
 * for display — the same gate `public.delivered_units` applies in SQL, so a
 * stale `deliveredQuantity` on an order moved back to a full delivery is
 * ignored on both sides.
 */
export const realizedTotal = (order: Pick<Order, 'status' | 'items' | 'discount' | 'deliveryFee' | 'total'>): number =>
  order.status === 'delivered_partial'
    ? deliveredTotals(order.items, order.discount, order.deliveryFee).total
    : order.total;

/** Units that count for an order: ordered, unless part of it never arrived. */
export const realizedUnits = (order: Pick<Order, 'status' | 'items'>): number =>
  order.status === 'delivered_partial' ? deliveredUnits(order.items) : orderedUnits(order.items);

/**
 * Next free order number. `order_number` is unique in the database, so a race
 * between two tabs surfaces as a write error rather than being silently resolved.
 */
export const nextOrderNumber = (orders: Order[]) => {
  const highest = orders.reduce((max, order) => {
    const digits = Number(order.orderNumber.replace(/\D/g, ''));
    return Number.isFinite(digits) && digits > max ? digits : max;
  }, 1000);
  return `ORD-${highest + 1}`;
};
