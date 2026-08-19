import React from 'react';
import { useAppStore } from '../store';
import {
  TrendingUp,
  Users,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Wallet
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend, ComposedChart, Line,
} from 'recharts';
import { statusLabels } from '../lib/dashboardStats';
import { useDimension, useMonthly, useStoreTotals, useTotals } from '../lib/queries';
import { usePagedList } from '../lib/queries';
import type { Order } from '../types';
import type { OrderStatus } from '../types';

const CHART_MONTHS = 6;
const RECENT_ORDERS = 6;

const formatNumber = (value: number) => Math.round(value).toLocaleString('en-US');
const formatCurrency = (value: number) => `${formatNumber(value)} د.ل`;

// Every mark sits at 3:1 or better against white, so series stay distinguishable
// without relying on hue alone.
const SERIES = { sales: '#0d9488', profit: '#8b5cf6', orders: '#0f766e', aov: '#8b5cf6' };
const CATEGORY_COLORS = ['#0d9488', '#8b5cf6', '#b45309', '#1d4ed8', '#be185d', '#4338ca'];
const STATUS_COLORS: Record<OrderStatus, string> = {
  new: '#1d4ed8',
  confirmed: '#6d28d9',
  processing: '#c2410c',
  shipped: '#4338ca',
  waiting: '#64748b',
  delivered: '#047857',
  delivered_partial: '#0f766e',
  canceled: '#be123c',
  returned: '#475569',
};

const axisTick = { fill: '#64748b', fontSize: 12 };
const tooltipStyle = {
  borderRadius: '12px',
  border: 'none',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
};

const Panel: React.FC<{ title: string; hint: string; children: React.ReactNode; className?: string }> = ({
  title, hint, children, className = '',
}) => (
  <div className={`glass-card p-6 rounded-2xl ${className}`}>
    <div className="mb-6">
      <h3 className="text-lg font-bold text-surface-900">{title}</h3>
      <p className="text-xs text-surface-500 mt-1">{hint}</p>
    </div>
    {children}
  </div>
);

const NoData: React.FC<{ message: string; height?: string }> = ({ message, height = 'h-64' }) => (
  <div className={`${height} flex items-center justify-center text-center text-sm text-surface-500`}>
    {message}
  </div>
);

const StatTile: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="bg-surface-50 border border-surface-200 rounded-2xl p-4">
    <p className="text-sm text-surface-500">{label}</p>
    {children}
  </div>
);

/**
 * Meter for a 0-1 rate only. A null rate renders as unavailable rather than a
 * misleading empty bar, and non-proportional figures use `Figure` instead so a
 * full bar never stands in for a number that has no ceiling.
 */
const Meter: React.FC<{ label: string; rate: number | null; color: string }> = ({ label, rate, color }) => (
  <StatTile label={label}>
    <b className="block text-2xl font-black text-surface-900 mt-2">
      {rate === null ? '—' : `${Math.round(rate * 100)}%`}
    </b>
    <div className="h-2 bg-surface-200 rounded-full overflow-hidden mt-3">
      <div
        className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${(rate ?? 0) * 100}%`, background: color }}
      />
    </div>
    {rate === null && <p className="text-xs text-surface-500 mt-2">غير متاح بعد</p>}
  </StatTile>
);

const Figure: React.FC<{ label: string; value: string | null; note?: string }> = ({ label, value, note }) => (
  <StatTile label={label}>
    <b className="block text-2xl font-black text-surface-900 mt-2">{value ?? '—'}</b>
    {(value === null || note) && (
      <p className="text-xs text-surface-500 mt-2">{value === null ? 'غير متاح بعد' : note}</p>
    )}
  </StatTile>
);

export const Dashboard: React.FC = () => {
  const { stores } = useAppStore();

  // Portfolio-wide: no store filter. Every figure is a SQL aggregate.
  const totals = useTotals(null);
  const monthlyRows = useMonthly(null, CHART_MONTHS);
  const salesByStoreRows = useDimension('store', null);
  const ordersByStatusRows = useDimension('status', null);
  const salesByCategoryRows = useDimension('category', null);
  const storeTotals = useStoreTotals();

  // Only the newest handful of orders is fetched, never the whole table.
  const recent = usePagedList<Order>({
    table: 'orders',
    columns: 'id,orderNumber:order_number,storeId:store_id,customerName:customer_name,total,status,createdAt:created_at',
    orderBy: 'created_at',
    page: 0,
    pageSize: RECENT_ORDERS,
  });

  const months = monthlyRows.map(row => ({
    key: row.month_start,
    name: new Date(row.month_start).toLocaleDateString('ar-LY', { month: 'long' }),
    sales: row.net_revenue,
    profit: row.profit,
    orderCount: row.order_count,
    aov: row.order_count > 0 ? row.net_revenue / row.order_count : 0,
  }));

  const salesByStore = salesByStoreRows.map(r => ({ name: r.label, value: r.revenue }));
  const salesByCategory = salesByCategoryRows.map(r => ({ name: r.label, value: r.revenue }));
  const ordersByStatus = ordersByStatusRows
    .map(r => ({ status: r.key as OrderStatus, name: statusLabels[r.key as OrderStatus] ?? r.key, value: r.order_count }))
    .filter(r => r.value > 0);

  const totalSales = totals?.net_revenue ?? 0;
  const netOfDiscount = (totals?.gross_sales ?? 0) - (totals?.discounts ?? 0);
  const totalProfit = netOfDiscount - (totals?.cogs ?? 0);
  const openOrders = ordersByStatus.find(r => r.status === 'new')?.value ?? 0;
  const allOrders = ordersByStatus.reduce((sum, r) => sum + r.value, 0);
  const delivered = ordersByStatus.find(r => r.status === 'delivered')?.value ?? 0;

  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const pct = (current: number, previous: number) =>
    previous > 0 ? ((current - previous) / previous) * 100 : null;
  const salesTrend = thisMonth && lastMonth ? pct(thisMonth.sales, lastMonth.sales) : null;
  const profitTrend = thisMonth && lastMonth ? pct(thisMonth.profit, lastMonth.profit) : null;

  const ops = {
    averageOrderValue: (totals?.realized_count ?? 0) > 0 ? totalSales / (totals!.realized_count) : null,
    completionRate: allOrders > 0 ? delivered / allOrders : null,
    // ponytail: satisfaction needs an aggregate over customer ratings; not wired yet.
    satisfaction: null as number | null,
  };

  const hasChartData = months.some(month => month.sales > 0 || month.profit > 0);
  const recentOrders = recent.rows;

  const topStores = [...stores]
    .sort((a, b) => (storeTotals.get(b.id)?.total_profit ?? 0) - (storeTotals.get(a.id)?.total_profit ?? 0))
    .slice(0, 5);

  const stats = [
    { label: 'إجمالي المبيعات', value: `${formatNumber(totalSales)} د.ل`, icon: DollarSign, trend: salesTrend },
    { label: 'إجمالي الأرباح', value: `${formatNumber(totalProfit)} د.ل`, icon: TrendingUp, trend: profitTrend },
    { label: 'الطلبات المفتوحة', value: openOrders.toString(), icon: ShoppingCart, trend: null },
    { label: 'إجمالي الطلبات', value: allOrders.toString(), icon: Users, trend: null },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="glass-card p-6 rounded-2xl relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-primary-50 rounded-full blur-2xl group-hover:bg-primary-100 transition-colors"></div>
            <div className="relative flex justify-between items-start">
              <div>
                <p className="text-surface-500 font-medium mb-1">{stat.label}</p>
                <h3 className="text-2xl font-black text-surface-900">{stat.value}</h3>
              </div>
              <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-primary-700 border border-surface-100">
                <stat.icon size={24} strokeWidth={1.5} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm relative">
              {stat.trend === null ? (
                <span className="text-surface-500">لا تتوفر مقارنة شهرية</span>
              ) : (
                <>
                  <span className={`flex items-center gap-1 font-bold ${stat.trend >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {stat.trend >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                    {stat.trend >= 0 ? '+' : ''}{stat.trend.toFixed(1)}%
                  </span>
                  <span className="text-surface-500">مقارنة بالشهر الماضي</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 glass-card p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-surface-900">المبيعات والأرباح (د.ل)</h3>
            <span className="text-sm font-medium text-surface-500">آخر {CHART_MONTHS} أشهر</span>
          </div>
          {!hasChartData ? (
            <div className="h-80 w-full flex flex-col items-center justify-center text-center">
              <p className="font-bold text-surface-900 mb-1">لا توجد مبيعات بعد</p>
              <p className="text-surface-500 text-sm">سيظهر الرسم البياني بمجرد تسجيل أول طلب.</p>
            </div>
          ) : (
          <div className="h-80 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dx="-10" tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold' }}
                  formatter={(value: number) => `${formatNumber(value)} د.ل`}
                />
                <Area type="monotone" dataKey="sales" name="المبيعات" stroke="#0d9488" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                <Area type="monotone" dataKey="profit" name="الأرباح" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          )}
        </div>

        {/* secondary stats */}
        <div className="space-y-6">
          <div className="glass-card p-6 rounded-2xl">
            <h3 className="text-lg font-bold text-surface-900 mb-6">أفضل المتاجر أداءً</h3>
            {topStores.length === 0 ? (
              <NoData message="لا توجد متاجر بعد." height="h-24" />
            ) : (
              <div className="space-y-5">
                {topStores.map(store => {
                  const st = storeTotals.get(store.id);
                  return (
                    <div key={store.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 shadow-sm bg-surface-200">
                          {store.image && <img src={store.image} alt="" loading="lazy" className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-surface-900 text-sm truncate">{store.name}</p>
                          <p className="text-xs text-surface-500 tabular-nums">{st?.order_count ?? 0} طلب</p>
                        </div>
                      </div>
                      <span className="font-bold text-emerald-700 text-sm tabular-nums shrink-0">
                        {formatCurrency(st?.total_profit ?? 0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          <div className="glass-card p-6 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 text-white border-0 shadow-lg shadow-primary-900/20">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-primary-100 font-medium mb-1">الرصيد المتاح للسحب</p>
                {/* No payouts table exists yet, so this stays an explicit placeholder
                    instead of a plausible-looking number. */}
                <h3 className="text-3xl font-black">—</h3>
                <p className="text-primary-100 text-xs font-medium mt-1">غير متاح بعد</p>
              </div>
              <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md">
                <Wallet size={24} className="text-white" />
              </div>
            </div>
            <button
              type="button"
              disabled
              className="w-full py-2.5 bg-white/60 text-primary-900 font-bold rounded-xl mt-2 shadow-sm cursor-not-allowed"
              title="ستتاح عمليات السحب بعد ربط الحسابات المالية"
            >
              سحب الأرباح
            </button>
          </div>
        </div>
      </div>

      {/* Breakdown panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="المبيعات حسب المتجر" hint="مساهمة كل متجر في الإيرادات">
          {salesByStore.length === 0 ? (
            <NoData message="لا توجد مبيعات مسجلة لأي متجر بعد." />
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByStore} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="name" width={132} axisLine={false} tickLine={false} tick={axisTick} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" name="المبيعات" radius={[0, 8, 8, 0]}>
                    {salesByStore.map((entry, index) => (
                      <Cell key={entry.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="حالات الطلبات" hint="توزيع الطلبات الحالية، شاملاً الملغاة والمرتجعة">
          {ordersByStatus.length === 0 ? (
            <NoData message="لا توجد طلبات بعد." />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="h-52 w-full sm:w-1/2 shrink-0" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={ordersByStatus} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2}>
                      {ordersByStatus.map(entry => (
                        <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} طلب`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Recharts' own legend collides once there are more than a few
                  statuses, so the key is laid out as a plain list instead. */}
              <ul className="w-full sm:w-1/2 space-y-2">
                {ordersByStatus.map(entry => (
                  <li key={entry.status} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.status] }} />
                    <span className="text-surface-700 flex-1 truncate">{entry.name}</span>
                    <b className="text-surface-900 tabular-nums">{entry.value}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="توزيع فئات المنتجات" hint="إيرادات كل فئة، محسوبة من بنود الطلبات">
          {salesByCategory.length === 0 ? (
            <NoData message="لن تظهر الفئات حتى تُسجَّل طلبات تحتوي منتجات معروفة." />
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="name" width={132} axisLine={false} tickLine={false} tick={axisTick} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" name="الإيرادات" radius={[0, 8, 8, 0]}>
                    {salesByCategory.map((entry, index) => (
                      <Cell key={entry.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="مؤشرات التشغيل" hint="محسوبة من الطلبات والتقييمات المسجَّلة">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Figure
              label="متوسط قيمة الطلب"
              value={ops.averageOrderValue === null ? null : formatCurrency(ops.averageOrderValue)}
              note="لكل طلب غير ملغى"
            />
            <Meter label="الطلبات المكتملة" rate={ops.completionRate} color={SERIES.profit} />
            <Meter label="رضا العملاء" rate={ops.satisfaction} color="#b45309" />
          </div>
          <p className="text-xs text-surface-500 mt-4">
            معدل التحويل يحتاج بيانات زيارات المتجر، وهي غير متوفرة حالياً.
          </p>
        </Panel>

        <Panel title="الطلبات ومتوسط قيمة السلة" hint="عدد الطلبات مقابل متوسط قيمة الطلب" className="lg:col-span-2">
          {!hasChartData ? (
            <NoData message="سيظهر هذا الرسم بعد تسجيل أول طلب." />
          ) : (
            <div className="h-80 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTick} dy={10} />
                  <YAxis yAxisId="count" axisLine={false} tickLine={false} tick={axisTick} allowDecimals={false} />
                  <YAxis yAxisId="aov" orientation="right" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={formatNumber} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name) =>
                      name === 'عدد الطلبات' ? `${value} طلب` : formatCurrency(value)
                    }
                  />
                  <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, direction: 'rtl' }} />
                  <Bar yAxisId="count" dataKey="orderCount" name="عدد الطلبات" fill={SERIES.orders} radius={[8, 8, 0, 0]} maxBarSize={44} />
                  <Line yAxisId="aov" type="monotone" dataKey="aov" name="متوسط قيمة الطلب" stroke={SERIES.aov} strokeWidth={3} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Recent Orders Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-surface-200/50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-surface-900">أحدث الطلبات</h3>
          <span className="text-sm text-surface-500">آخر {RECENT_ORDERS} طلبات</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-surface-50/50 text-surface-500 font-medium">
              <tr>
                <th className="px-6 py-4">رقم الطلب</th>
                <th className="px-6 py-4">العميل</th>
                <th className="px-6 py-4">المتجر</th>
                <th className="px-6 py-4">الإجمالي</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200/50">
              {recentOrders.map((order) => {
                const store = stores.find(s => s.id === order.storeId);
                return (
                  <tr key={order.id} className="hover:bg-surface-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-surface-900">{order.orderNumber}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-surface-600 font-bold text-xs">
                          {order.customerName.charAt(0)}
                        </div>
                        <span className="font-semibold text-surface-700">{order.customerName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-surface-600">{store?.name}</td>
                    <td className="px-6 py-4 font-bold text-surface-900 tabular-nums">{formatCurrency(order.total)}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        order.status === 'new' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' :
                        'bg-surface-100 text-surface-700'
                      }`}>
                        {statusLabels[order.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-surface-500">{new Date(order.createdAt).toLocaleDateString('ar-LY')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
