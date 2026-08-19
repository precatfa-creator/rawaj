import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../db/supabase';
import { normalizeArabic } from './arabic';
// Type-only in the other direction, so the two files do not form a runtime cycle.
import { orderTotalsArgs, type OrderFilters } from './orderFilters';

export const PAGE_SIZE = 24;

export interface Page<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: string;
  reload: () => void;
}

/** Comparisons a list filter can make beyond equality: date and amount ranges. */
export interface RangeFilter {
  column: string;
  op: 'gte' | 'lte';
  value: string;
}

export interface PagedQuery {
  table: 'products' | 'customers' | 'orders' | 'audit_log' | 'stock_entries';
  columns: string;
  /** Equality filters; undefined values are skipped. */
  match?: Record<string, string | undefined>;
  /** IN filters used for records shared by stores in one business group. */
  matchIn?: Record<string, string[]>;
  /** Column that must be null — how the portal asks for rows no store owns. */
  isNull?: string;
  /** Range comparisons; empty values are skipped. */
  filters?: RangeFilter[];
  /**
   * Matched against the table's generated `search_text` column. Only for tables
   * that have one — products, customers and orders.
   */
  search?: string;
  orderBy: string;
  ascending?: boolean;
  page: number;
  pageSize?: number;
  /**
   * `exact` counts every matching row, which is a full scan in Postgres. Lists
   * that can grow past a few thousand rows pass `estimated`: PostgREST answers
   * from the planner and only counts exactly while the table is small.
   */
  count?: 'exact' | 'estimated';
}

/** The equality, IN, null, range and search narrowing shared by every reader. */
export interface Narrowing {
  match?: Record<string, string | undefined>;
  matchIn?: Record<string, string[]>;
  isNull?: string;
  filters?: RangeFilter[];
  search?: string;
}

/**
 * Applied to a Supabase query builder. Exported so the list, the id sweep behind
 * "select every match", and the export all narrow by exactly the same rules —
 * a second copy of this is how a bulk action ends up hitting rows the operator
 * never saw.
 */
interface FilterBuilder {
  eq: (column: string, value: string) => FilterBuilder;
  in: (column: string, values: string[]) => FilterBuilder;
  is: (column: string, value: null) => FilterBuilder;
  gte: (column: string, value: string) => FilterBuilder;
  lte: (column: string, value: string) => FilterBuilder;
  ilike: (column: string, value: string) => FilterBuilder;
}

export const narrow = <Q,>(request: Q, { match, matchIn, isNull, filters, search }: Narrowing): Q => {
  let query = request as unknown as FilterBuilder;
  Object.entries(match ?? {}).forEach(([column, value]) => {
    if (value !== undefined && value !== null && value !== '') query = query.eq(column, value);
  });
  Object.entries(matchIn ?? {}).forEach(([column, values]) => {
    if (values.length > 0) query = query.in(column, values);
  });
  if (isNull) query = query.is(isNull, null);
  (filters ?? []).forEach(({ column, op, value }) => {
    if (value !== '') query = op === 'gte' ? query.gte(column, value) : query.lte(column, value);
  });
  const term = normalizeArabic(search ?? '');
  if (term) query = query.ilike('search_text', `%${term}%`);
  return query as unknown as Q;
};

/**
 * Ids of every row the narrowing matches, capped.
 *
 * Backs "select all N results": bulk actions take ids, and sending 2 000 of
 * them is cheaper and far more predictable than teaching every mutation to
 * repeat the filter server-side. The cap is reported so the UI can say how many
 * it actually selected rather than pretending it took the lot.
 */
export const matchingIds = async (
  table: PagedQuery['table'],
  narrowing: Narrowing,
  cap: number,
): Promise<{ ids: string[]; capped: boolean }> => {
  const { data, error } = await narrow(supabase.from(table).select('id'), narrowing).limit(cap + 1);
  if (error) {
    console.error(`Failed to list ${table} ids`, error);
    return { ids: [], capped: false };
  }
  const ids = (data ?? []).map(row => (row as { id: string }).id);
  return { ids: ids.slice(0, cap), capped: ids.length > cap };
};

/**
 * A value that settles before it is used as a query key.
 *
 * Every keystroke in a search box is a round trip otherwise, and the count that
 * comes back with it is the expensive half.
 */
export const useDebounced = <T,>(value: T, ms = 250): T => {
  const [settled, setSettled] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    // The initial value is already settled; waiting on it would blank the first
    // paint of a page opened from a link that carries a search term.
    if (first.current) { first.current = false; return; }
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return settled;
};

/**
 * One page of rows plus the server-side total.
 *
 * The count is `exact` so list headers and tab badges report the whole table,
 * not the loaded page — the failure mode being avoided is a plausible-looking
 * number that only describes the current 24 rows.
 */
export const usePagedList = <T,>(query: PagedQuery): Page<T> => {
  const { table, columns, match, matchIn, isNull, filters, search, orderBy, ascending = false, page, pageSize = PAGE_SIZE, count: countMode = 'exact' } = query;
  const matchKey = JSON.stringify(match ?? {});
  const matchInKey = JSON.stringify(matchIn ?? {});
  // Serialised for the same reason `match` is: an array literal rebuilt on every
  // render would restart the effect on every keystroke.
  const filtersKey = JSON.stringify(filters ?? []);

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const run = async () => {
      const request = narrow(supabase.from(table).select(columns, { count: countMode }), {
        match: JSON.parse(matchKey) as Record<string, string | undefined>,
        matchIn: JSON.parse(matchInKey) as Record<string, string[]>,
        isNull,
        filters: JSON.parse(filtersKey) as RangeFilter[],
        search,
      });

      const from = page * pageSize;
      const { data, count, error: queryError } = await request
        .order(orderBy, { ascending })
        .range(from, from + pageSize - 1);

      if (!active) return;
      if (queryError) {
        console.error(`Failed to load ${table}`, queryError);
        setError('تعذر تحميل البيانات.');
      } else {
        setError('');
        setRows((data ?? []) as unknown as T[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    };

    void run();
    return () => { active = false; };
  }, [table, columns, matchKey, matchInKey, isNull, filtersKey, search, orderBy, ascending, page, pageSize, countMode, token]);

  // Realtime keeps the *current page* fresh rather than patching rows into local
  // state, which would reintroduce optimistic-update drift.
  useEffect(() => {
    const channel = supabase
      .channel(`paged-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => reload())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [table, reload]);

  return { rows, total, loading, error, reload };
};

// ---- server-side aggregates ----

export interface Totals {
  gross_sales: number; discounts: number; delivery_fees: number; net_revenue: number;
  cogs: number; order_count: number; realized_count: number; untracked_cost_lines: number;
}

export interface MonthRow {
  month_start: string; gross_sales: number; net_revenue: number; discounts: number;
  delivery_fees: number; cogs: number; profit: number; order_count: number;
}

export interface DimensionRow {
  key: string; label: string; order_count: number; units: number; revenue: number; profit: number;
}

export interface StoreTotalRow {
  store_id: string; product_count: number; order_count: number;
  customer_count: number; total_sales: number; total_profit: number;
}

/** Postgres returns numerics as strings; every aggregate field is coerced once here. */
const toNumbers = <T,>(rows: unknown[]): T[] =>
  rows.map(row => {
    const out: Record<string, unknown> = {};
    Object.entries(row as Record<string, unknown>).forEach(([key, value]) => {
      const asNumber = typeof value === 'string' && value !== '' && !Number.isNaN(Number(value));
      const isIdentifier = key === 'key' || key === 'label' || key === 'store_id'
        || key === 'rep_id' || key === 'month_start';
      out[key] = asNumber && !isIdentifier
        ? Number(value)
        : value;
    });
    return out as T;
  });

const rpc = async <T,>(name: string, args: Record<string, unknown>): Promise<T[]> => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) { console.error(`${name} failed`, error); return []; }
  return toNumbers<T>((data ?? []) as unknown[]);
};

/** Re-runs whenever `deps` change or any of `tables` emits a realtime event. */
const useAggregate = <T,>(load: () => Promise<T>, initial: T, deps: unknown[], tables: string[]): T => {
  const [value, setValue] = useState<T>(initial);
  const [token, setToken] = useState(0);
  const key = JSON.stringify(deps);

  useEffect(() => {
    let active = true;
    void load().then(result => { if (active) setValue(result); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  useEffect(() => {
    const channel = supabase.channel(`agg-${tables.join('-')}-${key}`);
    tables.forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => setToken(t => t + 1));
    });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return value;
};

export const useTotals = (storeId: string | null): Totals | null =>
  useAggregate<Totals | null>(
    async () => (await rpc<Totals>('stats_totals', { p_store_id: storeId }))[0] ?? null,
    null, [storeId], ['orders', 'products'],
  );

export const useMonthly = (storeId: string | null, months: number): MonthRow[] =>
  useAggregate<MonthRow[]>(
    () => rpc<MonthRow>('stats_by_month', { p_store_id: storeId, p_months: months }),
    [], [storeId, months], ['orders', 'products'],
  );

export const useDimension = (dimension: string, storeId: string | null, limit = 100): DimensionRow[] =>
  useAggregate<DimensionRow[]>(
    () => rpc<DimensionRow>('stats_by_dimension', { p_dimension: dimension, p_store_id: storeId, p_limit: limit }),
    [], [dimension, storeId, limit], ['orders', 'products', 'customers'],
  );

export interface SalesRepTotalRow {
  rep_id: string; order_count: number; realized_count: number;
  revenue: number; commission_due: number;
}

export const useSalesRepTotals = (storeId: string | null): Map<string, SalesRepTotalRow> => {
  const rows = useAggregate<SalesRepTotalRow[]>(
    () => rpc<SalesRepTotalRow>('sales_rep_totals', { p_store_id: storeId }),
    [], [storeId], ['orders', 'sales_reps'],
  );
  return new Map(rows.map(row => [row.rep_id, row]));
};

export interface OrderTotalsRow {
  order_count: number; units: number; subtotal: number;
  discount: number; delivery_fee: number; total: number;
}

/**
 * Totals for every order the current filters match — not for the page on
 * screen. Same filter object the list query consumes, turned into arguments by
 * `orderTotalsArgs`, so the two cannot drift apart.
 */
export const useOrderTotals = (filters: OrderFilters): OrderTotalsRow | null => {
  const args = orderTotalsArgs(filters);
  return useAggregate<OrderTotalsRow | null>(
    async () => (await rpc<OrderTotalsRow>('orders_totals', args))[0] ?? null,
    null, [args], ['orders'],
  );
};

export const useStoreTotals = (): Map<string, StoreTotalRow> => {
  const rows = useAggregate<StoreTotalRow[]>(
    () => rpc<StoreTotalRow>('store_totals', {}),
    [], [], ['orders', 'products', 'stores'],
  );
  return new Map(rows.map(row => [row.store_id, row]));
};

/**
 * Server-backed option lookup for comboboxes, so a picker searches the whole
 * table instead of a preloaded slice.
 */
export const searchOptions = async (
  table: 'products' | 'customers',
  columns: string,
  term: string,
  match: Record<string, string | undefined> = {},
  limit = 30,
  matchIn: Record<string, string[]> = {},
): Promise<Record<string, unknown>[]> => {
  let request = supabase.from(table).select(columns);
  Object.entries(match).forEach(([column, value]) => {
    if (value) request = request.eq(column, value);
  });
  Object.entries(matchIn).forEach(([column, values]) => {
    if (values.length > 0) request = request.in(column, values);
  });
  const normalized = normalizeArabic(term);
  if (normalized) request = request.ilike('search_text', `%${normalized}%`);
  const { data, error } = await request.order('name').limit(limit);
  if (error) { console.error(`searchOptions(${table}) failed`, error); return []; }
  return (data ?? []) as unknown as Record<string, unknown>[];
};
