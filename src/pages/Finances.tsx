import React, { useState } from 'react';
import { Wallet, TrendingUp, Receipt, Percent, Info, Download } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useAppStore } from '../store';
import { downloadCsv, toCsv } from '../lib/finance';
import { useMonthly, useTotals } from '../lib/queries';
import { Combobox } from '../components/Combobox';
import { Card, DataTable, Metric, PageHead, count, money, percent, quietButton } from '../components/ui';

const RANGES = [
  { value: '3', label: 'آخر 3 أشهر' },
  { value: '6', label: 'آخر 6 أشهر' },
  { value: '12', label: 'آخر 12 شهراً' },
];

export const Finances: React.FC = () => {
  const { activeStoreId } = useAppStore();
  const [range, setRange] = useState('6');
  const months = Number(range);

  // Both come from SQL aggregates over every matching row, not from a loaded page.
  const totals = useTotals(activeStoreId);
  const monthly = useMonthly(activeStoreId, months).map(row => ({
    key: row.month_start,
    name: new Date(row.month_start).toLocaleDateString('ar-LY', { month: 'long' }),
    grossSales: row.gross_sales,
    discounts: row.discounts,
    deliveryFees: row.delivery_fees,
    netRevenue: row.net_revenue,
    cogs: row.cogs,
    grossProfit: (row.gross_sales - row.discounts) - row.cogs,
    margin: (row.gross_sales - row.discounts) > 0
      ? ((row.gross_sales - row.discounts) - row.cogs) / (row.gross_sales - row.discounts)
      : null,
    orderCount: row.order_count,
  }));

  const netOfDiscount = (totals?.gross_sales ?? 0) - (totals?.discounts ?? 0);
  const ledger = {
    netRevenue: totals?.net_revenue ?? 0,
    cogs: totals?.cogs ?? 0,
    grossProfit: netOfDiscount - (totals?.cogs ?? 0),
    margin: netOfDiscount > 0 ? (netOfDiscount - (totals?.cogs ?? 0)) / netOfDiscount : null,
    orderCount: totals?.realized_count ?? 0,
    untrackedCostLines: totals?.untracked_cost_lines ?? 0,
  };

  const hasData = monthly.some(month => month.orderCount > 0);
  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const profitTrend = current && previous && previous.grossProfit !== 0
    ? ((current.grossProfit - previous.grossProfit) / Math.abs(previous.grossProfit)) * 100
    : null;

  const exportCsv = () => {
    const csv = toCsv(
      ['الشهر', 'المبيعات', 'الخصومات', 'التوصيل', 'صافي الإيراد', 'تكلفة البضاعة', 'إجمالي الربح', 'الهامش', 'الطلبات'],
      monthly.map(month => [
        month.name,
        Math.round(month.grossSales),
        Math.round(month.discounts),
        Math.round(month.deliveryFees),
        Math.round(month.netRevenue),
        Math.round(month.cogs),
        Math.round(month.grossProfit),
        month.margin === null ? '' : (month.margin * 100).toFixed(1) + '%',
        month.orderCount,
      ]),
    );
    downloadCsv(`finances-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <PageHead title="المالية" subtitle="الإيرادات والتكاليف والربح، محسوبة من الطلبات المسجّلة.">
        <div className="flex items-center gap-3">
          <Combobox label="الفترة" value={range} onChange={setRange} options={RANGES} className="w-44" />
          <button onClick={exportCsv} className={quietButton}>
            <Download size={18} />
            تصدير CSV
          </button>
        </div>
      </PageHead>

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900">
        <Info size={18} className="shrink-0 mt-0.5" />
        <p className="text-sm font-medium leading-relaxed">
          هذه أرقام <strong>إجمالي الربح</strong> وليست صافي الربح — لا يوجد جدول للمصروفات بعد،
          فالإيجار والإعلانات والرواتب غير محتسبة.
          {ledger.untrackedCostLines > 0 && ` كما أن ${count(ledger.untrackedCostLines)} بنداً لا يمكن حساب تكلفته لأن منتجه محذوف.`}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="صافي الإيراد" value={money(ledger.netRevenue)} hint={`${count(ledger.orderCount)} طلب`} icon={<Wallet size={18} />} />
        <Metric label="تكلفة البضاعة" value={money(ledger.cogs)} icon={<Receipt size={18} />} />
        <Metric
          label="إجمالي الربح"
          value={money(ledger.grossProfit)}
          tone={ledger.grossProfit >= 0 ? 'positive' : 'negative'}
          hint={profitTrend === null ? 'لا تتوفر مقارنة شهرية' : `${profitTrend >= 0 ? '+' : ''}${profitTrend.toFixed(1)}% عن الشهر الماضي`}
          icon={<TrendingUp size={18} />}
        />
        <Metric label="هامش الربح" value={percent(ledger.margin)} icon={<Percent size={18} />} />
      </div>

      <Card className="p-6">
        <div className="mb-6">
          <h3 className="text-lg font-black text-surface-900">الإيراد مقابل التكلفة والربح</h3>
          <p className="text-xs text-surface-500 mt-1">آخر {months} أشهر</p>
        </div>
        {!hasData ? (
          <div className="h-72 grid place-items-center text-center text-sm text-surface-500">
            لا توجد طلبات في هذه الفترة.
          </div>
        ) : (
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={v => Math.round(v).toLocaleString('en-US')} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgb(15 23 42 / 0.12)' }}
                  formatter={(value: number) => money(value)}
                />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, direction: 'rtl' }} />
                <Bar dataKey="netRevenue" name="صافي الإيراد" fill="#0d9488" radius={[8, 8, 0, 0]} maxBarSize={40} />
                <Bar dataKey="cogs" name="تكلفة البضاعة" fill="#b45309" radius={[8, 8, 0, 0]} maxBarSize={40} />
                <Line type="monotone" dataKey="grossProfit" name="إجمالي الربح" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="p-5 border-b border-surface-200/70">
          <h3 className="text-lg font-black text-surface-900">التفصيل الشهري</h3>
        </div>
        <DataTable
          headers={['الشهر', 'المبيعات', 'الخصومات', 'التوصيل', 'صافي الإيراد', 'تكلفة البضاعة', 'إجمالي الربح', 'الهامش', 'الطلبات']}
          isEmpty={monthly.length === 0}
          empty="لا توجد بيانات."
        >
          {monthly.map(month => (
            <tr key={month.key} className="hover:bg-surface-50/60 transition-colors">
              <td className="px-5 py-3.5 font-bold text-surface-900">{month.name}</td>
              <td className="px-5 py-3.5 tabular-nums text-surface-700">{money(month.grossSales)}</td>
              <td className="px-5 py-3.5 tabular-nums text-surface-500">−{money(month.discounts)}</td>
              <td className="px-5 py-3.5 tabular-nums text-surface-700">{money(month.deliveryFees)}</td>
              <td className="px-5 py-3.5 tabular-nums font-bold text-surface-900">{money(month.netRevenue)}</td>
              <td className="px-5 py-3.5 tabular-nums text-amber-800">{money(month.cogs)}</td>
              <td className={`px-5 py-3.5 tabular-nums font-black ${month.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {money(month.grossProfit)}
              </td>
              <td className="px-5 py-3.5 tabular-nums text-surface-700">{percent(month.margin)}</td>
              <td className="px-5 py-3.5 tabular-nums text-surface-700">{count(month.orderCount)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  );
};
