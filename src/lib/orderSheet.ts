import { toNumber } from './sheet';
import type { OrderItem } from '../types';

/**
 * An order's lines, in one spreadsheet cell.
 *
 * An order is not a flat record — it carries a list — and a sheet has one cell
 * per column. Writing one row per line instead would make "which rows are the
 * same order" a thing the importer has to guess, and a re-imported export could
 * then split one order into several. So the lines live in a single cell, in a
 * shape a person can read and retype:
 *
 *   SKU * 2 @ 120 # M ؛ SKU-2 * 1
 *
 * `*` quantity, `@` unit price, `#` size. Only the identifier and the quantity
 * are required — a missing price means "whatever the item sells for now", which
 * is what someone typing a new order into a blank template expects.
 */
export interface ParsedLine {
  /** SKU, or the product name when the item has no SKU. */
  ident: string;
  quantity: number;
  /** Undefined when the cell did not say — the caller fills in the item's price. */
  price?: number;
  size?: string;
}

const LINE_SEPARATOR = /[;؛\n]/;

/** `SKU * 2 @ 120 # M`, tolerant of spacing and of Arabic-Indic digits. */
const LINE_PATTERN = /^(.*?)\s*[*x×]\s*([^@#]+?)(?:\s*@\s*([^#]+?))?(?:\s*#\s*(.*))?$/;

export const formatOrderItems = (items: OrderItem[], skuById: Map<string, string>): string =>
  items
    .map(item => {
      const ident = skuById.get(item.productId) || item.productName;
      const size = item.size ? ` # ${item.size}` : '';
      return `${ident} * ${item.quantity} @ ${item.price}${size}`;
    })
    .join(' ؛ ');

export interface ParseResult {
  lines: ParsedLine[];
  /** Text that did not parse at all, quoted back so the operator can find it. */
  invalid: string[];
}

export const parseOrderItems = (cell: string): ParseResult => {
  const result: ParseResult = { lines: [], invalid: [] };

  cell.split(LINE_SEPARATOR).map(part => part.trim()).filter(Boolean).forEach(part => {
    const match = part.match(LINE_PATTERN);
    const ident = match?.[1]?.trim() ?? '';
    const quantity = match ? toNumber(match[2] ?? '', 0) : 0;

    if (!match || !ident || quantity <= 0) {
      result.invalid.push(part);
      return;
    }

    const rawPrice = match[3]?.trim();
    const size = match[4]?.trim();
    result.lines.push({
      ident,
      quantity: Math.round(quantity),
      ...(rawPrice ? { price: toNumber(rawPrice, 0) } : {}),
      ...(size ? { size } : {}),
    });
  });

  return result;
};
