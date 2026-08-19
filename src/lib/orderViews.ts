import type { Order, OrderStatus, SalesRep } from '../types';

export type OrderGroupBy = 'customer' | 'item' | 'rep' | 'status';

export interface OrderViewGroup {
  key: string;
  label: string;
  orders: Order[];
  orderCount: number;
  units: number;
  total: number;
  /** Item groups total their own lines; every other group totals whole orders. */
  totalKind: 'orders' | 'lines';
}

const unitsOf = (order: Order) =>
  order.items.reduce((sum, item) => sum + item.quantity, 0);

const labelSort = new Intl.Collator('ar-LY', { numeric: true, sensitivity: 'base' });

/**
 * Turns one filtered order result into the sections used by Group view.
 *
 * An order appears once for customer, representative and status. Under items it
 * appears once per product it contains, because a two-product order genuinely
 * belongs to both product groups. Repeated lines of the same product (usually
 * different sizes) are combined before the group totals are updated.
 */
export const groupOrders = (
  orders: readonly Order[],
  by: OrderGroupBy,
  reps: readonly Pick<SalesRep, 'id' | 'name'>[],
  statusLabels: Record<OrderStatus, string>,
): OrderViewGroup[] => {
  const groups = new Map<string, OrderViewGroup>();
  const repNames = new Map(reps.map(rep => [rep.id, rep.name]));

  const take = (key: string, label: string, totalKind: OrderViewGroup['totalKind']) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created: OrderViewGroup = {
      key, label, orders: [], orderCount: 0, units: 0, total: 0, totalKind,
    };
    groups.set(key, created);
    return created;
  };

  orders.forEach(order => {
    if (by === 'item') {
      const lines = new Map<string, { label: string; units: number; total: number }>();
      order.items.forEach(item => {
        const key = item.productId || `name:${item.productName}`;
        const line = lines.get(key) ?? { label: item.productName || 'منتج غير مسمى', units: 0, total: 0 };
        line.units += item.quantity;
        line.total += item.quantity * item.price;
        lines.set(key, line);
      });
      lines.forEach((line, key) => {
        const group = take(key, line.label, 'lines');
        group.orders.push(order);
        group.orderCount += 1;
        group.units += line.units;
        group.total += line.total;
      });
      return;
    }

    const key = by === 'customer'
      ? order.customerId || `name:${order.customerName}`
      : by === 'rep'
        ? order.agentId || 'unassigned'
        : order.status;
    const label = by === 'customer'
      ? order.customerName || 'عميل غير مسمى'
      : by === 'rep'
        ? (order.agentId ? repNames.get(order.agentId) ?? 'مندوب غير معروف' : 'بدون مندوب')
        : statusLabels[order.status];
    const group = take(key, label, 'orders');
    group.orders.push(order);
    group.orderCount += 1;
    group.units += unitsOf(order);
    group.total += order.total;
  });

  const result = [...groups.values()];
  if (by === 'status') {
    // statusLabels is already the lifecycle's single ordered source; copying
    // that order here would make the next status appear at the end by accident.
    const rank = new Map((Object.keys(statusLabels) as OrderStatus[]).map((status, index) => [status, index]));
    return result.sort((a, b) => (rank.get(a.key as OrderStatus) ?? 99) - (rank.get(b.key as OrderStatus) ?? 99));
  }
  return result.sort((a, b) => labelSort.compare(a.label, b.label));
};
