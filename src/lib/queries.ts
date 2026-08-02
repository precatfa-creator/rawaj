import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../db/supabase';
import { normalizeArabic } from './arabic';

export const PAGE_SIZE = 24;

export interface Page<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: string;
  reload: () => void;
}

export interface PagedQuery {
  table: 'products' | 'customers' | 'orders' | 'audit_log';
  columns: string;
  /** Equality filters; undefined values are skipped. */
  match?: Record<string, string | undefined>;
  /** Matched against the table's generated `search_text` column. */
  search?: string;
  orderBy: string;
  ascending?: boolean;
  page: number;
  pageSize?: number;
}

/**
 * One page of rows plus the server-side total.
 *
 * The count is `exact` so list headers and tab badges report the whole table,
 * not the loaded page — the failure mode being avoided is a plausible-looking
 * number that only describes the current 24 rows.
 */
export const usePagedList = <T,>(query: PagedQuery): Page<T> => {
  const { table, columns, match, search, orderBy, ascending = false, page, pageSize = PAGE_SIZE } = query;
  const matchKey = JSON.stringify(match ?? {});

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
      let request = supabase.from(table).select(columns, { count: 'exact' });

      Object.entries(JSON.parse(matchKey) as Record<string, string | undefined>).forEach(([column, value]) => {
        if (value !== undefined && value !== null && value !== '') request = request.eq(column, value);
      });

      const term = normalizeArabic(search ?? '');
      if (term) request = request.ilike('search_text', `%${term}%`);

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
  }, [table, columns, matchKey, search, orderBy, ascending, page, pageSize, token]);

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
): Promise<Record<string, unknown>[]> => {
  let request = supabase.from(table).select(columns);
  Object.entries(match).forEach(([column, value]) => {
    if (value) request = request.eq(column, value);
  });
  const normalized = normalizeArabic(term);
  if (normalized) request = request.ilike('search_text', `%${normalized}%`);
  const { data, error } = await request.order('name').limit(limit);
  if (error) { console.error(`searchOptions(${table}) failed`, error); return []; }
  return (data ?? []) as unknown as Record<string, unknown>[];
};
