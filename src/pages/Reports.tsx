import React, { useState } from 'react';
import { Download, PieChart as PieIcon, Package, Users, MapPin } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useAppStore } from '../store';
import { statusLabels } from '../lib/dashboardStats';
import { downloadCsv, toCsv } from '../lib/finance';
import { useDimension } from '../lib/queries';
import { Combobox } from '../components/Combobox';
import { Card, DataTable, EmptyState, PageHead, Pill, count, money, quietButton } from '../components/ui';
import type { OrderStatus } from '../types';

const STATUS_COLORS: Record<OrderStatus, string> = {
  new: '#1d4ed8', confirmed: '#6d28d9', processing: '#c2410c', shipped: '#4338ca',
  waiting: '#64748b', delivered: '#047857', delivered_partial: '#0f766e',
  canceled: '#be123c', returned: '#475569',
};

const REPORTS = [
  { value: 'products', label: 'أداء المنتجات' },
  { value: 'customers', label: 'أفضل العملاء' },
  { value: 'zones', label: 'الطلبات حسب المدينة' },
  { value: 'status', label: 'حالات الطلبات' },
];

const TOP_N = 15;

export const Reports: React.FC = () => {
  const { activeStoreId } = useAppStore();
  const [report, setReport] = useState('products');

  // Every row here is grouped by Postgres over the whole table.
  const productRows = useDimension('product', activeStoreId, TOP_N)
    .map(r => ({ id: r.key, name: r.label, sku: '', units: r.units, revenue: r.revenue, profit: r.profit }));
  const customerRows = useDimension('customer', activeStoreId, TOP_N)
    .map(r => ({ id: r.key, name: r.label, city: '', orders: r.order_count, spent: r.revenue }));
  const statusRows = useDimension('status', activeStoreId)
    .map(r => ({ status: r.key as OrderStatus, name: statusLabels[r.key as OrderStatus] ?? r.key, value: r.order_count }))
    .filter(row => row.value > 0);
  const cityRows = useDimension('city', activeStoreId)
    .map(r => ({ city: r.label, orders: r.order_count, revenue: r.revenue }));

  const totalOrders = statusRows.reduce((sum, row) => sum + row.value, 0);

  const exports: Record<string, () => void> = {
    products: () => downloadCsv('products-report.csv', toCsv(
      ['المنتج', 'SKU', 'الوحدات المباعة', 'الإيراد', 'الربح'],
      productRows.map(r => [r.name, r.sku, r.units, Math.round(r.revenue), Math.round(r.profit)]),
    )),
    customers: () => downloadCsv('customers-report.csv', toCsv(
      ['العميل', 'المدينة', 'عدد الطلبات', 'إجمالي الإنفاق'],
      customerRows.map(r => [r.name, r.city, r.orders, Math.round(r.spent)]),
    )),
    zones: () => downloadCsv('cities-report.csv', toCsv(
      ['المدينة', 'عدد الطلبات', 'الإيراد'],
      cityRows.map(r => [r.city, r.orders, Math.round(r.revenue)]),
    )),
    status: () => downloadCsv('status-report.csv', toCsv(
      ['الحالة', 'عدد الطلبات'],
      statusRows.map(r => [r.name, r.value]),
    )),
  };

  const empty = totalOrders === 0;

  return (
    <div className="space-y-6">
      <PageHead title="التقارير" subtitle="ملخّصات جاهزة للتصدير، محسوبة من طلبات هذا المتجر.">
        <div className="flex items-center gap-3">
          <Combobox label="التقرير" value={report} onChange={setReport} options={REPORTS} className="w-56" />
          <button onClick={exports[report]} disabled={empty} className={`${quietButton} disabled:opacity-50`}>
            <Download size={18} />
            تصدير CSV
          </button>
        </div>
      </PageHead>

      {empty ? (
        <EmptyState
          icon={<PieIcon size={30} />}
          title="لا توجد بيانات بعد"
          body="سجّل أول طلب لهذا المتجر لتظهر التقارير."
        />
      ) : report === 'products' ? (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-surface-200/70 flex items-center gap-2">
            <Package size={18} className="text-primary-700" />
            <h3 className="text-lg font-black text-surface-900">أعلى {Math.min(TOP_N, productRows.length)} منتجاً بالإيراد</h3>
          </div>
          <DataTable headers={['#', 'المنتج', 'SKU', 'الوحدات', 'الإيراد', 'الربح']} isEmpty={productRows.length === 0} empty="لا توجد مبيعات.">
            {productRows.map((row, index) => (
              <tr key={row.id} className="hover:bg-surface-50/60 transition-colors">
                <td className="px-5 py-3.5 text-surface-400 font-bold tabular-nums">{index + 1}</td>
                <td className="px-5 py-3.5 font-bold text-surface-900">{row.name}</td>
                <td className="px-5 py-3.5 text-surface-500" dir="ltr">{row.sku || '—'}</td>
                <td className="px-5 py-3.5 tabular-nums text-surface-700">{count(row.units)}</td>
                <td className="px-5 py-3.5 tabular-nums font-bold text-surface-900">{money(row.revenue)}</td>
                <td className="px-5 py-3.5 tabular-nums font-bold text-emerald-700">{money(row.profit)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : report === 'customers' ? (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-surface-200/70 flex items-center gap-2">
            <Users size={18} className="text-primary-700" />
            <h3 className="text-lg font-black text-surface-900">أفضل {Math.min(TOP_N, customerRows.length)} عميلاً</h3>
          </div>
          <DataTable headers={['#', 'العميل', 'المدينة', 'الطلبات', 'إجمالي الإنفاق']} isEmpty={customerRows.length === 0} empty="لا يوجد عملاء.">
            {customerRows.map((row, index) => (
              <tr key={row.id} className="hover:bg-surface-50/60 transition-colors">
                <td className="px-5 py-3.5 text-surface-400 font-bold tabular-nums">{index + 1}</td>
                <td className="px-5 py-3.5 font-bold text-surface-900">{row.name}</td>
                <td className="px-5 py-3.5 text-surface-600">{row.city || '—'}</td>
                <td className="px-5 py-3.5 tabular-nums text-surface-700">{count(row.orders)}</td>
                <td className="px-5 py-3.5 tabular-nums font-bold text-surface-900">{money(row.spent)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : report === 'zones' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <MapPin size={18} className="text-primary-700" />
              <h3 className="text-lg font-black text-surface-900">الإيراد حسب المدينة</h3>
            </div>
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cityRows.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={v => Math.round(v).toLocaleString('en-US')} />
                  <YAxis type="category" dataKey="city" width={110} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgb(15 23 42 / 0.12)' }} formatter={(v: number) => money(v)} />
                  <Bar dataKey="revenue" name="الإيراد" fill="#0d9488" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-surface-200/70">
              <h3 className="text-lg font-black text-surface-900">التفصيل</h3>
            </div>
            <DataTable headers={['المدينة', 'الطلبات', 'الإيراد']} isEmpty={cityRows.length === 0} empty="لا توجد بيانات.">
              {cityRows.map(row => (
                <tr key={row.city} className="hover:bg-surface-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-bold text-surface-900">{row.city}</td>
                  <td className="px-5 py-3.5 tabular-nums text-surface-700">{count(row.orders)}</td>
                  <td className="px-5 py-3.5 tabular-nums font-bold text-surface-900">{money(row.revenue)}</td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-lg font-black text-surface-900 mb-6">توزيع حالات الطلبات</h3>
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusRows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                    {statusRows.map(row => <Cell key={row.status} fill={STATUS_COLORS[row.status]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgb(15 23 42 / 0.12)' }} formatter={(v: number) => `${v} طلب`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="text-lg font-black text-surface-900 mb-6">التفصيل</h3>
            <ul className="space-y-3">
              {statusRows.map(row => (
                <li key={row.status} className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: STATUS_COLORS[row.status] }} />
                  <span className="flex-1 font-bold text-surface-800">{row.name}</span>
                  <Pill>{count(row.value)} طلب</Pill>
                  <span className="text-sm text-surface-500 tabular-nums w-14 text-left">
                    {totalOrders ? ((row.value / totalOrders) * 100).toFixed(0) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
};
