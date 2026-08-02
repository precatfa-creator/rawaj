import type { Customer, Order, Product } from '../types';
import { isRealized } from './dashboardStats';

export interface Ledger {
  /** Σ line prices before discounts and delivery. */
  grossSales: number;
  discounts: number;
  deliveryFees: number;
  /** What was actually charged: grossSales − discounts + deliveryFees. */
  netRevenue: number;
  /** Σ purchase price × quantity for lines whose product is known. */
  cogs: number;
  /**
   * (grossSales − discounts) − cogs. Gross, not net: this app has no expenses
   * table, so rent, ads and salaries are not in here.
   */
  grossProfit: number;
  /** grossProfit ÷ (grossSales − discounts), or null with no sales. */
  margin: number | null;
  orderCount: number;
  /** netRevenue ÷ orderCount, or null with no orders. */
  averageOrderValue: number | null;
  /** Lines whose product row is missing, so their cost is unknown. */
  untrackedCostLines: number;
}

const emptyLedger = (): Ledger => ({
  grossSales: 0, discounts: 0, deliveryFees: 0, netRevenue: 0, cogs: 0,
  grossProfit: 0, margin: null, orderCount: 0, averageOrderValue: null, untrackedCostLines: 0,
});

const finalise = <T extends Ledger>(ledger: T): T => {
  const netOfDiscount = ledger.grossSales - ledger.discounts;
  ledger.grossProfit = netOfDiscount - ledger.cogs;
  ledger.margin = netOfDiscount > 0 ? ledger.grossProfit / netOfDiscount : null;
  ledger.averageOrderValue = ledger.orderCount > 0 ? ledger.netRevenue / ledger.orderCount : null;
  return ledger;
};

export const buildLedger = (orders: Order[], products: Product[]): Ledger => {
  const costById = new Map<string, number>(products.map(p => [p.id, p.purchasePrice]));
  const ledger = emptyLedger();

  orders.filter(isRealized).forEach(order => {
    ledger.orderCount += 1;
    ledger.discounts += order.discount;
    ledger.deliveryFees += order.deliveryFee;
    ledger.netRevenue += order.total;
    order.items.forEach(item => {
      ledger.grossSales += item.price * item.quantity;
      const cost = costById.get(item.productId);
      if (cost === undefined) ledger.untrackedCostLines += 1;
      else ledger.cogs += cost * item.quantity;
    });
  });

  return finalise(ledger);
};

export interface MonthlyLedger extends Ledger {
  key: string;
  name: string;
}

export const buildMonthlyLedgers = (
  orders: Order[],
  products: Product[],
  monthCount: number,
  now: Date = new Date(),
): MonthlyLedger[] => {
  const months: MonthlyLedger[] = Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
    return {
      ...emptyLedger(),
      key: `${date.getFullYear()}-${date.getMonth()}`,
      name: date.toLocaleDateString('ar-LY', { month: 'long' }),
    };
  });
  const byKey = new Map(months.map(month => [month.key, month]));

  orders.filter(isRealized).forEach(order => {
    const created = new Date(order.createdAt);
    const bucket = byKey.get(`${created.getFullYear()}-${created.getMonth()}`);
    if (!bucket) return;
    const single = buildLedger([order], products);
    bucket.grossSales += single.grossSales;
    bucket.discounts += single.discounts;
    bucket.deliveryFees += single.deliveryFees;
    bucket.netRevenue += single.netRevenue;
    bucket.cogs += single.cogs;
    bucket.orderCount += single.orderCount;
    bucket.untrackedCostLines += single.untrackedCostLines;
  });

  return months.map(month => finalise(month));
};

// ---- report rows ----

export interface ProductReportRow {
  id: string;
  name: string;
  sku: string;
  units: number;
  revenue: number;
  profit: number;
}

export const topProducts = (orders: Order[], products: Product[]): ProductReportRow[] => {
  const byId = new Map<string, Product>(products.map(p => [p.id, p]));
  const rows = new Map<string, ProductReportRow>();

  orders.filter(isRealized).forEach(order => {
    order.items.forEach(item => {
      const product = byId.get(item.productId);
      const row = rows.get(item.productId) ?? {
        id: item.productId,
        name: product?.name ?? item.productName,
        sku: product?.sku ?? '',
        units: 0, revenue: 0, profit: 0,
      };
      row.units += item.quantity;
      row.revenue += item.price * item.quantity;
      row.profit += (product?.margin ?? 0) * item.quantity;
      rows.set(item.productId, row);
    });
  });

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
};

export interface CustomerReportRow {
  id: string;
  name: string;
  city: string;
  orders: number;
  spent: number;
}

export const topCustomers = (orders: Order[], customers: Customer[]): CustomerReportRow[] => {
  const byId = new Map<string, Customer>(customers.map(c => [c.id, c]));
  const rows = new Map<string, CustomerReportRow>();

  orders.filter(isRealized).forEach(order => {
    const customer = byId.get(order.customerId);
    const row = rows.get(order.customerId) ?? {
      id: order.customerId,
      name: customer?.name ?? order.customerName,
      city: customer?.city ?? '',
      orders: 0, spent: 0,
    };
    row.orders += 1;
    row.spent += order.total;
    rows.set(order.customerId, row);
  });

  return [...rows.values()].sort((a, b) => b.spent - a.spent);
};

/**
 * CSV with a UTF-8 BOM — without it Excel reads Arabic columns as mojibake.
 */
export const toCsv = (headers: string[], rows: (string | number)[][]): string => {
  const escape = (cell: string | number) => {
    const text = String(cell ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
};

export const downloadCsv = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
