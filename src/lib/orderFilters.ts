import { normalizeArabic } from './arabic';
import type { RangeFilter } from './queries';

/**
 * What the orders screen is currently showing.
 *
 * One object with two consumers — the paged list query and the totals RPC — so
 * the row of totals cannot end up describing a different set of orders than the
 * rows above it. That is the whole reason this lives apart from the page.
 */
export interface OrderFilters {
  storeId: string | null;
  /** '' means every status. */
  status: string;
  agentId: string;
  zoneId: string;
  search: string;
  /** Calendar days as `yyyy-mm-dd`, inclusive at both ends. */
  from: string;
  to: string;
  minTotal: string;
  maxTotal: string;
}

export const emptyOrderFilters = (storeId: string | null): OrderFilters => ({
  storeId, status: '', agentId: '', zoneId: '', search: '',
  from: '', to: '', minTotal: '', maxTotal: '',
});

/**
 * A calendar day as an instant, in the browser's timezone.
 *
 * `created_at` is a timestamptz, so comparing it against a bare '2026-08-14'
 * would compare against midnight UTC — in Libya (UTC+2) that silently drops the
 * first two hours of the day for `from`, and includes two hours of the next day
 * for `to`.
 */
export const dayStart = (day: string): string =>
  day ? new Date(`${day}T00:00:00.000`).toISOString() : '';

export const dayEnd = (day: string): string =>
  day ? new Date(`${day}T23:59:59.999`).toISOString() : '';

/** The range comparisons `usePagedList` applies on top of the equality matches. */
export const orderRangeFilters = (filters: OrderFilters): RangeFilter[] => [
  { column: 'created_at', op: 'gte', value: dayStart(filters.from) },
  { column: 'created_at', op: 'lte', value: dayEnd(filters.to) },
  { column: 'total', op: 'gte', value: filters.minTotal },
  { column: 'total', op: 'lte', value: filters.maxTotal },
];

/** The same filters as arguments to `orders_totals`. Empty reads as "no filter". */
export const orderTotalsArgs = (filters: OrderFilters): Record<string, unknown> => ({
  p_store_id: filters.storeId || null,
  p_status: filters.status || null,
  p_agent_id: filters.agentId || null,
  p_zone_id: filters.zoneId || null,
  // Normalised here the way the client normalises its `ilike` term, because
  // search_text is a generated column of ar_normalize(...) on the other side.
  p_search: normalizeArabic(filters.search) || null,
  p_from: dayStart(filters.from) || null,
  p_to: dayEnd(filters.to) || null,
  p_min_total: filters.minTotal === '' ? null : Number(filters.minTotal),
  p_max_total: filters.maxTotal === '' ? null : Number(filters.maxTotal),
});

/** True when anything narrows the list beyond the store it belongs to. */
export const isFiltered = (filters: OrderFilters): boolean =>
  Boolean(filters.status || filters.agentId || filters.zoneId || filters.search
    || filters.from || filters.to || filters.minTotal || filters.maxTotal);
