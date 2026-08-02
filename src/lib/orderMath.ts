import type { Order, OrderItem } from '../types';

/** subtotal = Σ price×qty; total = subtotal − discount + delivery, never below 0. */
export const orderTotals = (items: OrderItem[], discount: number, deliveryFee: number) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { subtotal, total: Math.max(0, subtotal - discount + deliveryFee) };
};

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
