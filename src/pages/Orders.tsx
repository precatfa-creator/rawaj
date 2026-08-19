import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { supabase } from '../db/supabase';
import {
  Plus, Search, Eye, Truck, CheckCircle2, ShoppingCart, Trash2, X, Pencil,
  SlidersHorizontal, RefreshCw, Rows3, Images, ListTree,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { OrderStatus } from '../types';
import {
  ALL_STATUSES, STATUS_ACCENT_BASE, STATUS_ACCENT_NONE, statusAccent, statusLabels, statusWash,
} from '../lib/dashboardStats';
import {
  matchingIds, PAGE_SIZE, useDimension, useMatchingRows, useOrderTotals, usePagedList,
  type Narrowing,
} from '../lib/queries';
import {
  filterParams, filtersFromParams, isFiltered, orderRangeFilters, type OrderFilters,
} from '../lib/orderFilters';
import {
  deleteOrders, orderStatusesOf, setOrderAgent, setOrderStatus,
  setPartialDelivery,
} from '../lib/mutations';
import { orderBulk } from '../lib/bulk';
import { describeOrderItems } from '../lib/auditText';
import { repCoversZone } from '../lib/commission';
import { announceDelivery } from '../lib/celebrate';
import { groupOrders, type OrderGroupBy } from '../lib/orderViews';
import { Confirm, ErrorNote, ReasonPrompt } from '../components/Confirm';
import { OrderDetails } from '../components/orderDetails';
import { OrderForm } from '../components/orderForms';
import { PartialDeliveryPrompt } from '../components/PartialDelivery';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { money, Pagination, quietButton, Thumb } from '../components/ui';
import type { Order } from '../types';
import type { PagedProps } from '../lib/route';


/** The three a fulfillment shift applies all day; the rest live in the dropdown. */
const QUICK_STATUSES: OrderStatus[] = ['processing', 'shipped', 'delivered'];

/** Statuses that mean the order is still somebody's job. */
const OPEN_STATUSES = new Set<OrderStatus>(['new', 'confirmed', 'processing', 'shipped', 'waiting']);

/** Days an open order may sit before the list starts calling it out. */
const STALE_DAYS = 3;

/** The two endings that need explaining, and the words for asking. */
const HALT_PROMPTS: Partial<Record<OrderStatus, { title: string; message: string; confirmLabel: string; tone: 'danger' | 'primary' }>> = {
  canceled: {
    title: 'إلغاء الطلب',
    message: 'سيُسجَّل سبب الإلغاء مع الطلب وفي سجل التغييرات.',
    confirmLabel: 'إلغاء الطلب',
    tone: 'danger',
  },
  returned: {
    title: 'تسجيل مرتجع',
    message: 'سيُسجَّل سبب الإرجاع مع الطلب وفي سجل التغييرات.',
    confirmLabel: 'تسجيل المرتجع',
    tone: 'primary',
  },
  // A hold is not an ending, but it is the same kind of change: the row
  // afterwards says the order stopped moving and not why.
  waiting: {
    title: 'تعليق الطلب',
    message: 'سيُسجَّل سبب الانتظار مع الطلب وفي سجل التغييرات.',
    confirmLabel: 'تعليق الطلب',
    tone: 'primary',
  },
};

/** Ceiling on "select every result" — see `matchingIds`. */
const SELECT_ALL_CAP = 2000;

const PAGE_SIZES = [24, 50, 100];
const PAGE_SIZE_KEY = 'orders.pageSize';
const GROUP_CAP = 2000;

type OrderView = 'list' | 'images' | 'grouped';

const GROUP_OPTIONS: Array<{ value: OrderGroupBy; label: string }> = [
  { value: 'status', label: 'الحالة' },
  { value: 'customer', label: 'العميل' },
  { value: 'item', label: 'المنتج' },
  { value: 'rep', label: 'المندوب' },
];

const statusStyles: Record<OrderStatus, string> = {
  new: 'bg-blue-50 text-blue-800 border-blue-200',
  confirmed: 'bg-purple-50 text-purple-800 border-purple-200',
  processing: 'bg-orange-50 text-orange-800 border-orange-200',
  shipped: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  waiting: 'bg-slate-100 text-slate-700 border-slate-300',
  delivered: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  delivered_partial: 'bg-teal-50 text-teal-800 border-teal-200',
  canceled: 'bg-rose-50 text-rose-800 border-rose-200',
  returned: 'bg-amber-50 text-amber-900 border-amber-200',
};

/**
 * The active tab's count chip, tinted by the status it counts. Reuses
 * `statusStyles` so a status never wears two different colours on one page;
 * "all" has no status colour of its own, so it takes the neutral inverse.
 */
const statusBadge: Record<'all' | OrderStatus, string> = {
  all: 'bg-surface-900 text-white',
  ...statusStyles,
};

const ORDER_COLUMNS =
  'id,orderNumber:order_number,storeId:store_id,customerId:customer_id,customerName:customer_name,items,subtotal,discount,deliveryFee:delivery_fee,total,status,statusReason:status_reason,notes,createdAt:created_at,deliveryDate:delivery_date,agentId:agent_id,zoneId:zone_id';

const dayFormat = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'short' });
const day = (value: string | null | undefined) => (value ? dayFormat.format(new Date(value)) : '—');

const ageInDays = (value: string) => Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);

const dateField =
  'w-full bg-white border border-surface-200 rounded-xl px-3 py-2 text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

const checkboxClass =
  'w-4 h-4 rounded border-surface-300 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

const cell = 'px-5 py-4';

interface OrdersProps extends PagedProps {
  /** The open order, from the URL. */
  recordId: string | null;
  onRecord: (id: string | null) => void;
  /** Filters, sort and page size, also from the URL. */
  params: Record<string, string>;
  onParams: (next: Record<string, string>) => void;
}

/**
 * The orders list.
 *
 * Everything the screen is showing — filters, sort, page size, the open order —
 * lives in the URL rather than in state, because this is the screen where
 * somebody says "look at the late Tripoli deliveries", and that has to be a
 * link they can send.
 */
export const Orders: React.FC<OrdersProps> = ({ page, onPage, recordId, onRecord, params, onParams }) => {
  const { pickerProducts, pickerCustomers, zones, salesReps, activeStoreId, sharedStoreIds } = useAppStore();
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkedOrder, setLinkedOrder] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [halting, setHalting] = useState<{ ids: string[]; status: OrderStatus } | null>(null);
  const [partial, setPartial] = useState<Order | null>(null);

  const still = useReducedMotion();


  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const captureBody = (node: HTMLElement | null) => { bodyRef.current = node; };
  /** Anchor for shift-click range selection. */
  const anchorRef = useRef<number | null>(null);

  const active: OrderFilters = { ...filtersFromParams(params, activeStoreId), storeId: activeStoreId };
  const sort = params.sort === 'oldest' ? 'oldest' : 'newest';
  const view: OrderView = params.view === 'images' || params.view === 'grouped' ? params.view : 'list';
  const groupBy: OrderGroupBy = GROUP_OPTIONS.some(option => option.value === params.group)
    ? params.group as OrderGroupBy
    : 'status';
  /**
   * How many filters are narrowing the list, for the badge on the collapsed
   * panel. Status has its own toggle group above, so it is not counted twice.
   */
  const activeFilterCount = [
    active.agentId, active.zoneId, active.search, active.from, active.to,
    active.minTotal, active.maxTotal,
  ].filter(Boolean).length;

  // Remembered per browser so an operator who works 100 rows at a time is not
  // set back to 24 every morning; a link that carries a size still wins.
  const pageSize = useMemo(() => {
    const fromUrl = Number(params.size);
    if (PAGE_SIZES.includes(fromUrl)) return fromUrl;
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(saved) ? saved : PAGE_SIZE;
  }, [params.size]);

  /** Page-level parameters: sort and size. Any change resets the offset. */
  const setParam = (patch: Record<string, string>) => onParams({ ...params, ...patch });

  /** View state is linkable, just like the filters it presents. */
  const viewParams = {
    view: view === 'list' ? '' : view,
    group: view === 'grouped' && groupBy !== 'status' ? groupBy : '',
  };

  /**
   * A filter change rewrites the whole filter half of the query string, so a
   * cleared filter leaves the URL instead of lingering as `status=`.
   */
  const set = <K extends keyof OrderFilters>(field: K, value: OrderFilters[K]) =>
    onParams({ sort: params.sort ?? '', size: params.size ?? '', ...viewParams, ...filterParams({ ...active, [field]: value }) });

  // The search box types faster than Postgres can count, so the URL — and with
  // it the query — is only written once typing settles.
  const [searchText, setSearchText] = useState(active.search);
  const pushed = useRef(active.search);
  useEffect(() => {
    if (searchText === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = searchText;
      set('search', searchText);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchText]);
  // Back/forward, and "clear filters", have to reach the input too.
  useEffect(() => {
    if (active.search !== pushed.current) {
      pushed.current = active.search;
      setSearchText(active.search);
    }
  }, [active.search]);

  // One narrowing, three readers: the page of rows, the id sweep behind "select
  // every result", and the export. They cannot drift apart.
  const narrowing: Narrowing = {
    match: {
      store_id: activeStoreId ?? undefined,
      status: active.status || undefined,
      agent_id: active.agentId || undefined,
      zone_id: active.zoneId || undefined,
    },
    filters: orderRangeFilters(active),
    search: active.search,
  };

  const list = usePagedList<Order>({
    table: 'orders',
    columns: ORDER_COLUMNS,
    ...narrowing,
    orderBy: 'created_at',
    ascending: sort === 'oldest',
    page,
    pageSize,
    // This table grows by every order the business ever takes, and an exact
    // count is a full scan — the planner's estimate is what a page bar needs.
    count: 'estimated',
  });
  const pageOrders = list.rows;

  // Grouping a single pagination page would split one customer or product into
  // unrelated sections. Fetch the complete filtered result for this view, with
  // the same safety ceiling used by "select every result".
  const groupedResult = useMatchingRows<Order>({
    table: 'orders',
    columns: ORDER_COLUMNS,
    ...narrowing,
    orderBy: 'created_at',
    ascending: sort === 'oldest',
    enabled: view === 'grouped',
    cap: GROUP_CAP,
  });
  const visibleOrders = view === 'grouped' ? groupedResult.rows : pageOrders;
  const groupedOrders = useMemo(
    () => groupOrders(groupedResult.rows, groupBy, salesReps, statusLabels),
    [groupedResult.rows, groupBy, salesReps],
  );

  // A link can point at an order the current page or filters do not include, so
  // the one the URL names is fetched on its own when the list does not hold it.
  useEffect(() => {
    if (!recordId || visibleOrders.some(o => o.id === recordId)) return;
    let alive = true;
    void supabase.from('orders').select(ORDER_COLUMNS).eq('id', recordId).maybeSingle()
      .then(({ data }) => { if (alive) setLinkedOrder((data as Order | null) ?? null); });
    return () => { alive = false; };
  }, [recordId, visibleOrders]);

  const openIndex = visibleOrders.findIndex(o => o.id === recordId);
  const openOrder =
    (openIndex >= 0 ? visibleOrders[openIndex] : null) ?? (linkedOrder?.id === recordId ? linkedOrder : null);

  // Totals for every order the filters match, computed in Postgres. Summing the
  // loaded page here would print a plausible number that describes 24 rows.
  const totals = useOrderTotals(active);

  // Tab badges count the whole table per status, and ignore the other filters —
  // they are how you see what the other statuses hold.
  const statusCounts = new Map(useDimension('status', activeStoreId).map(r => [r.key, r.order_count]));
  const totalOrders = [...statusCounts.values()].reduce((sum, n) => sum + n, 0);

  const storeProducts = pickerProducts.filter(p => p.storeId === activeStoreId);
  const allVisibleSelected = visibleOrders.length > 0 && visibleOrders.every(o => selected.has(o.id));

  // Rebuilt only when the store or the reference lists change; a new object per
  // render would restart BulkBar's state on every keystroke in the search box.
  // The export reads the live filters through a ref for the same reason.
  const narrowingRef = useRef(narrowing);
  narrowingRef.current = narrowing;
  const bulkSpec = useMemo(
    () => orderBulk(activeStoreId ?? '', { zones, salesReps }, () => narrowingRef.current),
    [activeStoreId, zones, salesReps],
  );

  const toggle = (id: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** Shift extends from the last row touched — 30 orders in two clicks. */
  const selectRow = (index: number, shift: boolean) => {
    const anchor = anchorRef.current;
    if (shift && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(current => {
        const next = new Set(current);
        visibleOrders.slice(from, to + 1).forEach(order => next.add(order.id));
        return next;
      });
      return;
    }
    anchorRef.current = index;
    toggle(visibleOrders[index].id);
  };

  const toggleAll = () => {
    anchorRef.current = null;
    setSelected(allVisibleSelected ? new Set() : new Set(visibleOrders.map(o => o.id)));
  };

  /** Beyond the visible page: every order the current filters match. */
  const selectEveryMatch = async () => {
    setNotice('');
    const { ids, capped } = await matchingIds('orders', narrowing, SELECT_ALL_CAP);
    setSelected(new Set(ids));
    setNotice(capped
      ? `حُدِّد أول ${SELECT_ALL_CAP.toLocaleString('en-US')} طلب من النتائج. ضيّق التصفية لتشمل الباقي.`
      : `حُدِّد ${ids.length.toLocaleString('en-US')} طلب من كل النتائج.`);
  };

  const writeStatus = async (ids: string[], status: OrderStatus, reason = '') => {
    setPendingId(ids.length === 1 ? ids[0] : 'bulk');
    setError('');
    setNotice('');
    // Read first: after the update the old statuses are gone, and a bulk change
    // is exactly where somebody needs them back.
    const previous = await orderStatusesOf(ids);
    const result = await setOrderStatus(ids, status, reason);
    setPendingId(null);
    if (!result.ok) { setError(result.message ?? ''); return result; }
    setSelected(new Set());

    // Only orders that actually crossed into a full delivery, so re-saving an
    // order already delivered does not throw a second party for the same event.
    if (status === 'delivered' && activeStoreId) {
      previous
        .filter(row => row.status !== 'delivered')
        .map(row => visibleOrders.find(order => order.id === row.id))
        .forEach(order => {
          if (!order) return;
          void announceDelivery(activeStoreId, {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            total: order.total,
          });
        });
    }
    return result;
  };

  /**
   * Ending a trip is asked about; moving along it is not. Every path into a
   * status change comes through here — the row dropdown, the quick buttons, the
   * bulk bar and the details dialog — so the question cannot be walked around.
   */
  const applyStatus = async (ids: string[], status: OrderStatus) => {
    // A partial delivery is per-order and per-line, so it cannot be applied to a
    // selection: which lines arrived is a different answer for every order.
    if (status === 'delivered_partial') {
      const [only] = ids;
      const order = ids.length === 1 ? visibleOrders.find(row => row.id === only) ?? linkedOrder : null;
      if (!order) {
        setError('حدّد طلباً واحداً لتسجيل تسليم جزئي — الأصناف التي وصلت تختلف من طلب لآخر.');
        return;
      }
      setPartial(order);
      return;
    }
    if (HALT_PROMPTS[status]) { setHalting({ ids, status }); return; }
    await writeStatus(ids, status);
  };



  /**
   * Reassignment after the fact, which is the normal case: a rep calls in sick,
   * or leaves and their orders need a new owner. Without this the rep chosen
   * while composing the order would be the only one it could ever have.
   */
  /**
   * A rep taking a batch has to serve every zone in it — the intersection of the
   * selection, not the union. Orders with no zone place no demand on the list,
   * and an empty selection leaves every active rep offered.
   */
  const selectedZoneNames = [...new Set(
    [...selected]
      .map(id => visibleOrders.find(row => row.id === id)?.zoneId)
      .map(zoneId => zones.find(zone => zone.id === zoneId)?.name ?? '')
      .filter(Boolean),
  )];
  const bulkAgents = salesReps.filter(
    rep => rep.active && selectedZoneNames.every(name => repCoversZone(rep, name)),
  );

  const applyAgent = async (ids: string[], agentId: string) => {
    setPendingId('bulk');
    setError('');
    const result = await setOrderAgent(ids, agentId || null);
    setPendingId(null);
    if (result.ok) setSelected(new Set());
    else setError(result.message ?? '');
  };

  /**
   * Keyboard for the people who live on this screen: `/` searches, `j`/`k` walk
   * the rows, `x` selects the focused one (with shift, the range), Enter opens.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        if (event.key === 'Escape') target.blur();
        return;
      }
      // A dialog owns the keyboard while it is open.
      if (recordId || creating || editing || confirmDelete || halting || partial) return;

      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); return; }

      const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-order-row]') ?? []);
      if (rows.length === 0) return;
      const current = rows.findIndex(row => row === document.activeElement || row.contains(document.activeElement));

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next = event.key === 'j' ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1);
        rows[next]?.focus();
        return;
      }
      if (event.key === 'x' && current >= 0) {
        event.preventDefault();
        const id = rows[current]?.dataset.orderId;
        if (!id) return;
        const orderIndex = visibleOrders.findIndex(order => order.id === id);
        if (view !== 'grouped' && orderIndex >= 0) selectRow(orderIndex, event.shiftKey);
        else toggle(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const actionButton =
    'inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-2.5 md:p-1.5 rounded-lg transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  const pageTotal = visibleOrders.reduce((sum, order) => sum + order.total, 0);
  const skeleton = (view === 'grouped' ? groupedResult.loading : list.loading) && visibleOrders.length === 0;

  const renderStatusControl = (order: Order, busy: boolean, className = 'min-w-32') => (
    <Combobox
      size="sm"
      label={`حالة الطلب ${order.orderNumber}`}
      value={order.status}
      disabled={busy}
      onChange={value => applyStatus([order.id], value as OrderStatus)}
      options={ALL_STATUSES.map(status => ({ value: status, label: statusLabels[status] }))}
      tone={`border ${statusStyles[order.status]}`}
      className={className}
    />
  );

  const renderOrderActions = (order: Order, busy: boolean) => (
    <div className="flex flex-wrap items-center gap-1 md:gap-2">
      <button
        onClick={() => onRecord(order.id)}
        className={`${actionButton} text-surface-500 hover:text-primary-700 hover:bg-primary-50`}
        aria-label={`عرض تفاصيل ${order.orderNumber}`} title="عرض التفاصيل"
      >
        <Eye size={18} />
      </button>
      <button
        onClick={() => setEditing(order)}
        disabled={busy}
        className={`${actionButton} text-surface-500 hover:text-primary-700 hover:bg-primary-50`}
        aria-label={`تعديل ${order.orderNumber}`} title="تعديل الطلب"
      >
        <Pencil size={18} />
      </button>
      <button
        onClick={() => applyStatus([order.id], 'shipped')}
        disabled={busy || order.status === 'shipped'}
        className={`${actionButton} text-surface-500 hover:text-indigo-700 hover:bg-indigo-50`}
        aria-label={`تغيير ${order.orderNumber} إلى ${statusLabels.shipped}`} title={`تغيير إلى ${statusLabels.shipped}`}
      >
        <Truck size={18} />
      </button>
      <button
        onClick={() => applyStatus([order.id], 'delivered')}
        disabled={busy || order.status === 'delivered'}
        className={`${actionButton} text-surface-500 hover:text-emerald-700 hover:bg-emerald-50`}
        aria-label={`تغيير ${order.orderNumber} إلى ${statusLabels.delivered}`} title={`تغيير إلى ${statusLabels.delivered}`}
      >
        <CheckCircle2 size={18} />
      </button>
      <button
        onClick={() => setConfirmDelete([order.id])}
        disabled={busy}
        className={`${actionButton} text-surface-500 hover:text-rose-700 hover:bg-rose-50`}
        aria-label={`حذف ${order.orderNumber}`} title="حذف الطلب"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );

  const renderOrderImages = (order: Order) => {
    const shown = order.items.slice(0, 4);
    if (shown.length === 0) {
      return (
        <div className="h-44 grid place-items-center bg-surface-100 text-surface-400">
          <ShoppingCart size={38} />
        </div>
      );
    }
    return (
      <div className="relative h-44 grid grid-cols-2 grid-rows-2 gap-1 bg-surface-100 p-1" aria-label={describeOrderItems(order.items)}>
        {shown.map((item, index) => (
          <Thumb
            key={`${item.productId}-${item.size ?? ''}-${index}`}
            src={item.image}
            name={item.productName}
            fit="contain"
            textClass="text-2xl"
            className={`w-full h-full bg-white ${
              shown.length === 1 ? 'col-span-2 row-span-2' : shown.length === 2 ? 'row-span-2' : index === 0 && shown.length === 3 ? 'row-span-2' : ''
            }`}
          />
        ))}
        {order.items.length > 4 && (
          <span className="absolute bottom-2 end-2 rounded-lg bg-surface-900/85 px-2 py-1 text-xs font-black text-white" dir="ltr">
            +{order.items.length - 4}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-surface-900">الطلبات</h2>
          <p className="text-surface-500 mt-1">تتبع وإدارة طلبات العملاء</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Plus size={20} />
          <span>طلب جديد</span>
        </button>
      </div>

      {/* A failed read used to print the empty state, which reads as "no
          orders" when it means "the query did not run". */}
      {(error || list.error || (view === 'grouped' ? groupedResult.error : '')) && (
        <ErrorNote message={error || list.error || groupedResult.error} />
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-primary-200 bg-primary-50 text-primary-900 font-bold text-sm p-3">
          {notice}
        </p>
      )}

      {/* A toggle group, not a row of loose buttons: one of these is always in
          effect, so the set reads as one control with a position in it. The
          indicator slides between positions rather than blinking, which is what
          makes the movement legible as "the same thing moved". */}
      <div
        role="group"
        aria-label="تصفية حسب الحالة"
        className="flex overflow-x-auto no-scrollbar gap-1 p-1 rounded-2xl border border-surface-200/80 bg-surface-100/70"
      >
        {(['all', ...ALL_STATUSES] as const).map(status => {
          const value = status === 'all' ? '' : status;
          const count = status === 'all' ? totalOrders : (statusCounts.get(status) ?? 0);
          const on = active.status === value;
          return (
            <button
              key={status}
              onClick={() => set('status', value)}
              aria-pressed={on}
              className={`relative shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                on ? 'text-surface-900' : count === 0 ? 'text-surface-400 hover:text-surface-600' : 'text-surface-600 hover:text-surface-900'
              }`}
            >
              {on && (
                <motion.span
                  aria-hidden
                  layoutId="statusPill"
                  transition={{ type: 'spring', stiffness: 400, damping: 34, duration: still ? 0 : undefined }}
                  className="absolute inset-0 rounded-xl bg-white shadow-sm shadow-surface-900/10 ring-1 ring-surface-200"
                />
              )}
              <span className="relative flex items-center gap-2">
                {status === 'all' ? 'الكل' : statusLabels[status]}
                {/* The count is a badge, not "(3)": at a glance it reads as a
                    quantity attached to the tab rather than part of its name. */}
                <span
                  className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-md text-[11px] tabular-nums transition-colors ${
                    on ? statusBadge[status] : 'bg-surface-200/80 text-surface-600'
                  }`}
                >
                  {count}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="glass-card rounded-2xl">
        <div className="p-4 border-b border-surface-200/50 flex flex-col md:flex-row md:flex-wrap md:items-center gap-3">
          <div className="flex-1 min-w-64 relative">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-surface-400">
              <Search size={20} />
            </div>
            <input
              ref={searchRef}
              type="search"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="ابحث برقم الطلب أو اسم العميل… (اضغط /)"
              aria-label="ابحث في الطلبات"
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-surface-50 border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors font-medium text-sm"
            />
          </div>
          <Combobox
            label="ترتيب الطلبات"
            value={sort}
            onChange={value => setParam({ sort: value === 'oldest' ? 'oldest' : '' })}
            options={[
              { value: 'newest', label: 'الأحدث أولاً' },
              { value: 'oldest', label: 'الأقدم أولاً' },
            ]}
            className="md:w-44"
          />
          {view !== 'grouped' && (
            <Combobox
              label="عدد الصفوف"
              value={String(pageSize)}
              onChange={value => {
                localStorage.setItem(PAGE_SIZE_KEY, value);
                setParam({ size: value === String(PAGE_SIZE) ? '' : value });
              }}
              options={PAGE_SIZES.map(size => ({ value: String(size), label: `${size} صف` }))}
              className="md:w-32"
            />
          )}
          <div role="group" aria-label="طريقة عرض الطلبات" className="flex rounded-xl border border-surface-200 bg-white p-1 shrink-0">
            {([
              ['list', 'قائمة', Rows3],
              ['images', 'صور', Images],
              ['grouped', 'تجميع', ListTree],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => onParams({
                  ...params,
                  view: id === 'list' ? '' : id,
                  group: id === 'grouped' && groupBy !== 'status' ? groupBy : '',
                })}
                aria-pressed={view === id}
                title={label}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  view === id ? 'bg-primary-50 text-primary-800' : 'text-surface-500 hover:text-surface-800'
                }`}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {view === 'grouped' && (
            <Combobox
              label="تجميع حسب"
              value={groupBy}
              onChange={value => setParam({ group: value === 'status' ? '' : value })}
              options={GROUP_OPTIONS}
              className="md:w-40"
            />
          )}
          {/* Realtime already refreshes the page on any write; this is for the
              other cases — a colleague's change that never reached this tab, or
              a request that failed while the browser was offline. */}
          <button
            type="button"
            onClick={() => { list.reload(); if (view === 'grouped') groupedResult.reload(); }}
            disabled={list.loading || groupedResult.loading}
            aria-label="تحديث الطلبات"
            title="تحديث الطلبات"
            className={`${quietButton} md:w-auto disabled:opacity-60`}
          >
            <RefreshCw size={16} className={list.loading || groupedResult.loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(current => !current)}
            aria-expanded={showFilters}
            className={`${quietButton} md:w-auto ${activeFilterCount > 0 ? 'border-primary-300 text-primary-800 bg-primary-50' : ''}`}
          >
            <SlidersHorizontal size={16} />
            تصفية
            {/* Counts only what this panel holds. Status lives in the toggle
                group above, so including it would light this button up with a
                badge reading 0 and a panel with nothing set in it. */}
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-primary-700 text-white text-[11px] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
          {/* Import/export lives here now rather than in a panel of its own: it
              is a toolbar action on this list, not a section of the page. */}
          <BulkBar
            spec={bulkSpec}
            title="استيراد وتصدير الطلبات"
            hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. التصدير يتبع التصفية المعروضة الآن. الطلب الموجود يُحدَّث، والجديد يُنشأ بنفس قواعد المخزون — المطابقة بالمعرّف ثم برقم الطلب. عمود المنتجات بالصيغة: SKU * الكمية @ السعر # المقاس، ويُفصل بين المنتجات بفاصلة منقوطة. العميل يجب أن يكون موجوداً مسبقاً، والإجمالي يُحسب من السطور."
          />
        </div>

        {showFilters && (
          <div className="p-4 border-b border-surface-200/50 bg-surface-50/60 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <Combobox
              showLabel
              label="المنطقة"
              value={active.zoneId}
              onChange={value => set('zoneId', value)}
              options={[
                { value: '', label: 'كل المناطق' },
                ...zones.map(zone => ({ value: zone.id, label: zone.name, hint: zone.code })),
              ]}
            />
            <Combobox
              showLabel
              label="المندوب"
              value={active.agentId}
              onChange={value => set('agentId', value)}
              options={[
                { value: '', label: 'كل المندوبين' },
                ...salesReps.map(rep => ({
                  value: rep.id,
                  label: rep.name,
                  hint: rep.zones.length > 0 ? rep.zones.join('، ') : 'كل المناطق',
                })),
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">من تاريخ</span>
                <input type="date" value={active.from} onChange={e => set('from', e.target.value)} className={dateField} />
              </label>
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إلى تاريخ</span>
                <input type="date" value={active.to} onChange={e => set('to', e.target.value)} className={dateField} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إجمالي من (د.ل)</span>
                <input type="number" min={0} inputMode="decimal" value={active.minTotal} onChange={e => set('minTotal', e.target.value)} className={dateField} />
              </label>
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إلى (د.ل)</span>
                <input type="number" min={0} inputMode="decimal" value={active.maxTotal} onChange={e => set('maxTotal', e.target.value)} className={dateField} />
              </label>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => onParams({ sort: params.sort ?? '', size: params.size ?? '', ...viewParams })}
                disabled={!isFiltered(active)}
                className={`${quietButton} disabled:opacity-50`}
              >
                <X size={16} />
                مسح المرشّحات
              </button>
            </div>
          </div>
        )}

        {view === 'list' ? (
        /* The header sticks to the top of this box rather than the page, which
           is what keeps column names on screen while a 100-row page scrolls. */
        <div className="overflow-auto max-h-[70dvh]">
          <table className="w-full text-sm text-right">
            <thead className="bg-surface-100/95 backdrop-blur text-surface-500 font-medium sticky top-0 z-10">
              <tr>
                <th className="px-5 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="تحديد كل الطلبات المعروضة"
                    className={checkboxClass}
                  />
                </th>
                <th className="px-5 py-3">رقم الطلب</th>
                <th className="px-5 py-3">العميل</th>
                <th className="px-5 py-3">المنتجات</th>
                <th className="px-5 py-3">المندوب</th>
                <th className="px-5 py-3">التسليم</th>
                <th className="px-5 py-3">الإجمالي</th>
                <th className="px-5 py-3">الحالة</th>
                <th className="px-5 py-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody ref={captureBody} className="divide-y divide-surface-200/50">
              {skeleton && Array.from({ length: 6 }, (_, i) => (
                <tr key={`skeleton-${i}`} className="animate-pulse">
                  <td className={cell} colSpan={9}><div className="h-5 rounded-lg bg-surface-100" /></td>
                </tr>
              ))}
              {visibleOrders.map((order, i) => {
                const busy = pendingId === order.id || pendingId === 'bulk';
                const rep = salesReps.find(item => item.id === order.agentId);
                const zone = zones.find(item => item.id === order.zoneId);
                const age = ageInDays(order.createdAt);
                const stale = OPEN_STATUSES.has(order.status) && age >= STALE_DAYS;
                return (
                  <motion.tr
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.03 }}
                    key={order.id}
                    tabIndex={0}
                    data-order-row=""
                    data-order-id={order.id}
                    aria-label={`عرض تفاصيل الطلب ${order.orderNumber}`}
                    onClick={event => {
                      if ((event.target as HTMLElement).closest(
                        'button, input, select, textarea, a, [role="button"], [role="option"], [role="combobox"]',
                      )) return;
                      onRecord(order.id);
                    }}
                    onKeyDown={event => {
                      if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      onRecord(order.id);
                    }}
                    className={`transition-[filter,background-color] hover:brightness-[0.985] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
                      selected.has(order.id) ? 'bg-primary-50/80' : statusWash[order.status]
                    }`}
                  >
                    {/* The accent rides the first cell rather than the row: a
                        border on a <tr> is unreliable once the table collapses
                        its borders. */}
                    <td className={`${cell} ${STATUS_ACCENT_BASE} ${statusAccent[order.status] ?? STATUS_ACCENT_NONE}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        // Selection runs off the click, where the shift key is
                        // readable; onChange only exists to keep React quiet.
                        onChange={() => {}}
                        onClick={event => selectRow(i, event.shiftKey)}
                        aria-label={`تحديد الطلب ${order.orderNumber}`}
                        className={checkboxClass}
                      />
                    </td>
                    <td className={cell}>
                      <div className="font-bold text-surface-900" translate="no">{order.orderNumber}</div>
                      <div className="text-xs text-surface-500 mt-1 flex items-center gap-1.5">
                        <span className="tabular-nums">{day(order.createdAt)}</span>
                        {stale && (
                          <span className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 tabular-nums">
                            متأخر {age} ي
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${cell} max-w-56`}>
                      <div className="font-semibold text-surface-900 truncate">{order.customerName}</div>
                      <div className="text-xs text-surface-500 mt-1 truncate">{zone?.name ?? 'بدون منطقة'}</div>
                    </td>
                    {/* Names, not thumbnails. A 32px picture cannot tell two red
                        dresses apart, and it left an empty grey square whenever a
                        product had no photo. The same phrasing the change log
                        uses, so an order reads identically in both places. */}
                    <td className={`${cell} max-w-64`}>
                      <div className="text-surface-800 truncate" title={describeOrderItems(order.items)}>
                        {order.items.length > 0 ? describeOrderItems(order.items) : '—'}
                      </div>
                    </td>
                    <td className={`${cell} text-surface-600 font-medium max-w-40 truncate`}>{rep?.name ?? 'بدون مندوب'}</td>
                    <td className={`${cell} text-surface-600 font-medium tabular-nums whitespace-nowrap`}>{day(order.deliveryDate)}</td>
                    <td className={`${cell} font-black text-surface-900 tabular-nums`}>{money(order.total)}</td>
                    <td className={cell}>
                      {renderStatusControl(order, busy)}
                    </td>
                    <td className={cell}>
                      {renderOrderActions(order, busy)}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>

            {/* Two rows on purpose: what is on screen, and what the filters
                actually select. Printing only the first is the mistake this
                table is trying not to make. */}
            {visibleOrders.length > 0 && (
              <tfoot className="bg-surface-50/80 border-t-2 border-surface-200 font-bold text-surface-900">
                <tr>
                  <td className="px-5 py-3" colSpan={6}>إجمالي هذه الصفحة ({visibleOrders.length} طلب)</td>
                  <td className="px-5 py-3 tabular-nums">{money(pageTotal)}</td>
                  <td className="px-5 py-3" colSpan={2} />
                </tr>
                {totals && (
                  <tr className="border-t border-surface-200">
                    <td className="px-5 py-3" colSpan={6}>
                      إجمالي كل النتائج ({totals.order_count.toLocaleString('en-US')} طلب · {totals.units.toLocaleString('en-US')} قطعة)
                      <span className="font-medium text-surface-500 text-xs block mt-0.5">
                        قبل الخصم {money(totals.subtotal)} · الخصم −{money(totals.discount)} · التوصيل {money(totals.delivery_fee)}
                      </span>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-lg font-black">{money(totals.total)}</td>
                    <td className="px-5 py-3" colSpan={2} />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
        ) : view === 'images' ? (
          <div ref={captureBody} className="p-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {skeleton && Array.from({ length: 6 }, (_, index) => (
              <div key={`image-skeleton-${index}`} className="h-96 rounded-2xl bg-surface-100 animate-pulse" />
            ))}
            {visibleOrders.map((order, index) => {
              const busy = pendingId === order.id || pendingId === 'bulk';
              const rep = salesReps.find(item => item.id === order.agentId);
              const zone = zones.find(item => item.id === order.zoneId);
              const age = ageInDays(order.createdAt);
              const stale = OPEN_STATUSES.has(order.status) && age >= STALE_DAYS;
              return (
                <motion.article
                  key={order.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.04 }}
                  tabIndex={0}
                  data-order-row=""
                  data-order-id={order.id}
                  aria-label={`عرض تفاصيل الطلب ${order.orderNumber}`}
                  onClick={event => {
                    if ((event.target as HTMLElement).closest(
                      'button, input, select, textarea, a, [role="button"], [role="option"], [role="combobox"]',
                    )) return;
                    onRecord(order.id);
                  }}
                  onKeyDown={event => {
                    if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    onRecord(order.id);
                  }}
                  className={`overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm cursor-pointer ${STATUS_ACCENT_BASE} ${statusAccent[order.status] ?? STATUS_ACCENT_NONE} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    selected.has(order.id) ? 'ring-2 ring-primary-500 bg-primary-50/40' : ''
                  }`}
                >
                  <div className="relative">
                    {renderOrderImages(order)}
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={() => {}}
                      onClick={event => selectRow(index, event.shiftKey)}
                      aria-label={`تحديد الطلب ${order.orderNumber}`}
                      className={`${checkboxClass} absolute top-3 start-3 w-5 h-5 bg-white shadow-sm`}
                    />
                    {stale && (
                      <span className="absolute top-3 end-3 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 shadow-sm">
                        متأخر {age} ي
                      </span>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-surface-900" translate="no">{order.orderNumber}</p>
                        <p className="mt-1 truncate font-bold text-surface-800">{order.customerName}</p>
                      </div>
                      <p className="shrink-0 text-lg font-black tabular-nums text-surface-900">{money(order.total)}</p>
                    </div>
                    <p className="line-clamp-2 min-h-10 text-sm leading-5 text-surface-600" title={describeOrderItems(order.items)}>
                      {order.items.length > 0 ? describeOrderItems(order.items) : 'بدون منتجات'}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-surface-500">
                      <span className="truncate">{rep?.name ?? 'بدون مندوب'}</span>
                      <span className="truncate">{zone?.name ?? 'بدون منطقة'}</span>
                      <span className="tabular-nums">إنشاء: {day(order.createdAt)}</span>
                      <span className="tabular-nums">تسليم: {day(order.deliveryDate)}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-200 pt-3">
                      {renderStatusControl(order, busy, 'min-w-36')}
                      {renderOrderActions(order, busy)}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        ) : (
          <div ref={captureBody} className="p-4 space-y-4">
            {skeleton && Array.from({ length: 4 }, (_, index) => (
              <div key={`group-skeleton-${index}`} className="h-40 rounded-2xl bg-surface-100 animate-pulse" />
            ))}
            {groupedResult.capped && (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                عُرض أول {GROUP_CAP.toLocaleString('en-US')} طلب فقط. ضيّق المرشّحات لرؤية تجميع كامل لبقية النتائج.
              </p>
            )}
            {groupedOrders.map(group => {
              const allGroupSelected = group.orders.every(order => selected.has(order.id));
              return (
                <section key={group.key} className="overflow-hidden rounded-2xl border border-surface-200 bg-white">
                  <div className={`flex flex-wrap items-center gap-3 border-b border-surface-200 bg-surface-50 px-4 py-3 ${
                    groupBy === 'status' ? `${STATUS_ACCENT_BASE} ${statusAccent[group.key as OrderStatus] ?? STATUS_ACCENT_NONE}` : ''
                  }`}>
                    <input
                      type="checkbox"
                      checked={allGroupSelected}
                      onChange={() => setSelected(current => {
                        const next = new Set(current);
                        group.orders.forEach(order => {
                          if (allGroupSelected) next.delete(order.id); else next.add(order.id);
                        });
                        return next;
                      })}
                      aria-label={`تحديد مجموعة ${group.label}`}
                      className={checkboxClass}
                    />
                    <h3 className="me-auto font-black text-surface-900">{group.label}</h3>
                    <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-surface-700 ring-1 ring-surface-200">
                      {group.orderCount.toLocaleString('en-US')} طلب
                    </span>
                    <span className="text-xs font-bold text-surface-500">
                      {group.units.toLocaleString('en-US')} قطعة
                    </span>
                    <span className="font-black tabular-nums text-surface-900">
                      {group.totalKind === 'lines' ? 'قيمة السطور ' : 'الإجمالي '}{money(group.total)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-white text-xs font-bold text-surface-500">
                        <tr>
                          <th className="w-12 px-4 py-2" />
                          <th className="px-4 py-2">رقم الطلب</th>
                          <th className="px-4 py-2">العميل والمنتجات</th>
                          <th className="px-4 py-2">المندوب</th>
                          <th className="px-4 py-2">الإجمالي</th>
                          <th className="px-4 py-2">الحالة</th>
                          <th className="px-4 py-2">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-200/60">
                        {group.orders.map(order => {
                          const busy = pendingId === order.id || pendingId === 'bulk';
                          const rep = salesReps.find(item => item.id === order.agentId);
                          return (
                            <tr
                              key={`${group.key}-${order.id}`}
                              tabIndex={0}
                              data-order-row=""
                              data-order-id={order.id}
                              onClick={event => {
                                if ((event.target as HTMLElement).closest(
                                  'button, input, select, textarea, a, [role="button"], [role="option"], [role="combobox"]',
                                )) return;
                                onRecord(order.id);
                              }}
                              onKeyDown={event => {
                                if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return;
                                event.preventDefault();
                                onRecord(order.id);
                              }}
                              className={`cursor-pointer transition-[filter,background-color] hover:brightness-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
                                selected.has(order.id) ? 'bg-primary-50/80' : statusWash[order.status]
                              }`}
                            >
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selected.has(order.id)}
                                  onChange={() => toggle(order.id)}
                                  aria-label={`تحديد الطلب ${order.orderNumber}`}
                                  className={checkboxClass}
                                />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="font-black text-surface-900" translate="no">{order.orderNumber}</span>
                                <span className="mt-1 block text-xs tabular-nums text-surface-500">{day(order.createdAt)}</span>
                              </td>
                              <td className="max-w-72 px-4 py-3">
                                <span className="block truncate font-bold text-surface-900">{order.customerName}</span>
                                <span className="mt-1 block truncate text-xs text-surface-500" title={describeOrderItems(order.items)}>
                                  {describeOrderItems(order.items) || '—'}
                                </span>
                              </td>
                              <td className="max-w-40 truncate px-4 py-3 text-surface-600">{rep?.name ?? 'بدون مندوب'}</td>
                              <td className="px-4 py-3 font-black tabular-nums text-surface-900">{money(order.total)}</td>
                              <td className="px-4 py-3">{renderStatusControl(order, busy)}</td>
                              <td className="px-4 py-3">{renderOrderActions(order, busy)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {view === 'images' && visibleOrders.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-surface-200 bg-surface-50/80 px-5 py-3 text-sm font-bold text-surface-900">
            <span className="me-auto">هذه الصفحة: {visibleOrders.length.toLocaleString('en-US')} طلب</span>
            <span className="tabular-nums">{money(pageTotal)}</span>
            {totals && (
              <span className="text-surface-600">
                كل النتائج: {totals.order_count.toLocaleString('en-US')} طلب · <strong className="text-surface-900 tabular-nums">{money(totals.total)}</strong>
              </span>
            )}
          </div>
        )}

        {!skeleton && visibleOrders.length === 0 && (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
              <ShoppingCart size={32} />
            </div>
            <h3 className="text-lg font-bold text-surface-900 mb-1">لا توجد طلبات</h3>
            <p className="text-surface-500">
              {isFiltered(active) ? 'لم يطابق أي طلب معايير البحث.' : 'أنشئ أول طلب لهذا المتجر.'}
            </p>
          </div>
        )}

        {view !== 'grouped' && (
          <Pagination page={page} total={list.total} pageSize={pageSize} onPage={onPage} loading={list.loading} />
        )}
      </div>

      {/* Sticky inside the content column rather than fixed to the window: by
          the time an operator reaches for the action the selected rows are
          usually scrolled past, but the bar still must not sit over the nav. */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 rounded-2xl border border-primary-200 bg-white/95 backdrop-blur shadow-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="font-bold text-sm text-primary-900 me-auto" aria-live="polite">
            {selected.size} طلب محدد
          </span>
          {allVisibleSelected && selected.size < list.total && (
            <button
              onClick={() => void selectEveryMatch()}
              className="text-xs font-bold text-primary-800 underline underline-offset-4 px-2 py-2 rounded-lg hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              تحديد كل النتائج ({list.total.toLocaleString('en-US')})
            </button>
          )}
          {QUICK_STATUSES.map(status => (
            <button
              key={status}
              onClick={() => applyStatus([...selected], status)}
              disabled={pendingId !== null}
              className="text-xs font-bold bg-white border border-primary-200 text-primary-800 rounded-lg px-3 py-2 hover:bg-primary-100 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {statusLabels[status]}
            </button>
          ))}
          <Combobox
            size="sm"
            label="حالة أخرى"
            value=""
            onChange={value => applyStatus([...selected], value as OrderStatus)}
            options={ALL_STATUSES.filter(status => !QUICK_STATUSES.includes(status))
              .map(status => ({ value: status, label: statusLabels[status] }))}
            disabled={pendingId !== null}
            placeholder="حالة أخرى…"
            className="w-36"
          />
          {salesReps.length > 0 && (
            <Combobox
              size="sm"
              label="إسناد إلى مندوب"
              value=""
              onChange={agentId => void applyAgent([...selected], agentId)}
              options={[
                { value: '', label: 'بدون مندوب' },
                ...bulkAgents.map(rep => ({
                  value: rep.id,
                  label: rep.name,
                  hint: rep.zones.length > 0 ? rep.zones.join('، ') : 'كل المناطق',
                })),
              ]}
              disabled={pendingId !== null}
              placeholder={bulkAgents.length > 0 ? 'إسناد إلى مندوب' : 'لا مندوب يغطي كل المناطق المحددة'}
              className="w-44"
            />
          )}
          <button
            onClick={() => setConfirmDelete([...selected])}
            disabled={pendingId !== null}
            className="text-xs font-bold bg-white border border-rose-200 text-rose-800 rounded-lg px-3 py-2 hover:bg-rose-50 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            حذف
          </button>
          <button
            onClick={() => { setSelected(new Set()); setNotice(''); }}
            aria-label="إلغاء التحديد"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-primary-800 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X size={16} />
          </button>
        </div>
      )}


      <OrderDetails
        order={openOrder}
        salesReps={salesReps}
        zones={zones}
        onClose={() => onRecord(null)}
        onEdit={target => { onRecord(null); setEditing(target); }}
        onStatus={(id, status) => void applyStatus([id], status)}
        onAgent={(id, agentId) => void applyAgent([id], agentId)}
        onPrev={openIndex > 0 ? () => onRecord(visibleOrders[openIndex - 1].id) : undefined}
        onNext={openIndex >= 0 && openIndex < visibleOrders.length - 1
          ? () => onRecord(visibleOrders[openIndex + 1].id)
          : undefined}
      />

      <OrderForm
        open={creating || editing !== null}
        order={editing}
        storeId={activeStoreId ?? ''}
        products={storeProducts}
        customers={pickerCustomers}
        zones={zones}
        salesReps={salesReps}
        customerStoreIds={sharedStoreIds}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <PartialDeliveryPrompt
        order={partial}
        onClose={() => setPartial(null)}
        onSubmit={async items => {
          const result = await setPartialDelivery(partial!.id, items);
          if (result.ok) setNotice('سُجّل التسليم الجزئي.');
          return result;
        }}
      />

      {halting && (
        <ReasonPrompt
          open
          title={HALT_PROMPTS[halting.status]!.title}
          message={halting.ids.length > 1
            ? `${HALT_PROMPTS[halting.status]!.message} (${halting.ids.length} طلب)`
            : HALT_PROMPTS[halting.status]!.message}
          confirmLabel={HALT_PROMPTS[halting.status]!.confirmLabel}
          tone={HALT_PROMPTS[halting.status]!.tone}
          onSubmit={async reason => {
            const result = await writeStatus(halting.ids, halting.status, reason);
            return result ?? { ok: true };
          }}
          onClose={() => setHalting(null)}
        />
      )}

      <Confirm
        open={confirmDelete !== null}
        title={confirmDelete && confirmDelete.length > 1 ? 'حذف الطلبات' : 'حذف الطلب'}
        message={
          confirmDelete && confirmDelete.length > 1
            ? `سيتم حذف ${confirmDelete.length} طلبات نهائياً. لا يمكن التراجع.`
            : 'سيتم حذف الطلب نهائياً. لا يمكن التراجع.'
        }
        confirmLabel="حذف"
        onConfirm={async () => {
          const result = await deleteOrders(confirmDelete ?? []);
          if (result.ok) setSelected(new Set());
          return result;
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
