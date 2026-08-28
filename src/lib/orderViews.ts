import { deliveredOf, realizedTotal, realizedUnits } from './orderMath';
import type { Order, OrderItem, OrderStatus, SalesRep } from '../types';

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

const labelSort = new Intl.Collator('ar-LY', { numeric: true, sensitivity: 'base' });

export interface OrderItemSummary {
  name: string;
  units: number;
  /** Distinct lines of that product in the order — its sizes or variants. */
  lines: number;
}

/**
 * One line per product, for the orders list.
 *
 * A three-size order of the same dress is three lines in `items` and reads, in a
 * table cell, as three near-identical rows of noise. Folded by name it is one
 * row and a count, which is the thing a person scanning the column is after.
 * `describeOrderItems` still spells every line out for the tooltip and the log —
 * this only decides what the cell draws.
 */
export const summariseItems = (
  items: readonly { productId?: string; productName: string; quantity: number }[],
): OrderItemSummary[] => {
  const rows = new Map<string, OrderItemSummary>();
  items.forEach(item => {
    const name = item.productName || 'صنف';
    // Keyed the way groupOrders keys its item groups, so two different products
    // that happen to share a name stay two rows.
    const key = item.productId || `name:${name}`;
    const row = rows.get(key) ?? { name, units: 0, lines: 0 };
    row.units += item.quantity;
    row.lines += 1;
    rows.set(key, row);
  });
  return [...rows.values()];
};

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
      // Counted at what arrived, so a product group's line value matches the
      // money the order rows above it report. `deliveredOf` is a no-op for
      // every status but `delivered_partial`.
      const counted = (item: OrderItem) =>
        order.status === 'delivered_partial' ? deliveredOf(item) : item.quantity;
      order.items.forEach(item => {
        const key = item.productId || `name:${item.productName}`;
        const line = lines.get(key) ?? { label: item.productName || 'منتج غير مسمى', units: 0, total: 0 };
        line.units += counted(item);
        line.total += counted(item) * item.price;
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
    group.units += realizedUnits(order);
    group.total += realizedTotal(order);
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
