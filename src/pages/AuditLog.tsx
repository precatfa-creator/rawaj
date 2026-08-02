import React, { useEffect, useState } from 'react';
import { ShieldCheck, Info, ChevronDown } from 'lucide-react';
import { supabase } from '../db/supabase';
import { PAGE_SIZE, usePagedList } from '../lib/queries';
import { Combobox } from '../components/Combobox';
import { Card, DataTable, EmptyState, PageHead, Pagination, Pill, count } from '../components/ui';
import type { PagedProps } from '../lib/route';

interface AuditRow {
  id: number;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actorId: string | null;
  actorRole: string;
  txid: number;
  changedAt: string;
  changedFields: string[];
  data: Record<string, unknown>;
}

const TABLE_LABELS: Record<string, string> = {
  stores: 'المتاجر',
  products: 'المنتجات',
  customers: 'العملاء',
  orders: 'الطلبات',
  delivery_zones: 'مناطق التوصيل',
  profiles: 'المستخدمون',
};

const ACTION_LABELS: Record<AuditRow['action'], string> = {
  INSERT: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
};

const ACTION_TONES: Record<AuditRow['action'], string> = {
  INSERT: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-800 border-blue-200',
  DELETE: 'bg-rose-50 text-rose-800 border-rose-200',
};

const short = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

export const AuditLog: React.FC<PagedProps> = ({ page, onPage }) => {
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [actors, setActors] = useState<Map<string, string>>(new Map());

  const list = usePagedList<AuditRow>({
    table: 'audit_log',
    columns: 'id,tableName:table_name,recordId:record_id,action,actorId:actor_id,actorRole:actor_role,txid,changedAt:changed_at,changedFields:changed_fields,data',
    match: { table_name: table || undefined, action: action || undefined },
    orderBy: 'changed_at',
    page,
  });

  // Names are resolved at read time; the log stores only the uid, so a deleted
  // profile still leaves a readable trail.
  useEffect(() => {
    void supabase.from('profiles').select('id,display_name,email').then(({ data }) => {
      setActors(new Map((data ?? []).map(row => [row.id as string, (row.display_name || row.email) as string])));
    });
  }, []);

  const describeActor = (row: AuditRow) => {
    if (row.actorId) return actors.get(row.actorId) ?? 'مستخدم محذوف';
    if (row.actorRole === 'service_role') return 'خدمة النظام';
    if (row.actorRole === 'postgres') return 'وصول مباشر لقاعدة البيانات';
    return row.actorRole || 'غير معروف';
  };

  return (
    <div className="space-y-6">
      <PageHead title="سجل التدقيق" subtitle="كل إضافة وتعديل وحذف في قاعدة البيانات، مسجّلة تلقائياً.">
        <Pill tone="bg-primary-50 text-primary-800 border-primary-200">
          <ShieldCheck size={14} />
          للقراءة فقط
        </Pill>
      </PageHead>

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900">
        <Info size={18} className="shrink-0 mt-0.5" />
        <p className="text-sm font-medium leading-relaxed">
          يغطي هذا السجل التغييرات على الجداول فقط. عمليات تسجيل الدخول وإعادة تعيين كلمة المرور ورفع الصور
          تحدث خارج هذه الجداول ولا تُسجَّل هنا. السجل غير قابل للتعديل أو الحذف، ولا يوجد حذف تلقائي للسجلات القديمة.
        </p>
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-3">
        <Combobox
          label="الجدول"
          value={table}
          onChange={value => { setTable(value); onPage(0); }}
          options={[{ value: '', label: 'كل الجداول' },
            ...Object.entries(TABLE_LABELS).map(([value, label]) => ({ value, label }))]}
          className="md:w-56"
        />
        <Combobox
          label="نوع العملية"
          value={action}
          onChange={value => { setAction(value); onPage(0); }}
          options={[{ value: '', label: 'كل العمليات' },
            ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))]}
          className="md:w-48"
        />
      </Card>

      {list.total === 0 && !list.loading ? (
        <EmptyState
          icon={<ShieldCheck size={30} />}
          title="لا توجد سجلات"
          body={table || action ? 'لم تطابق أي عملية هذه المرشّحات.' : 'ستظهر العمليات هنا فور حدوث أول تغيير.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <DataTable headers={['الوقت', 'المستخدم', 'الجدول', 'العملية', 'السجل', 'الحقول']}>
            {list.rows.map(row => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-surface-50/60 transition-colors">
                  <td className="px-5 py-3.5 text-surface-600 whitespace-nowrap tabular-nums">
                    {new Date(row.changedAt).toLocaleString('ar-LY')}
                  </td>
                  <td className="px-5 py-3.5 font-bold text-surface-900">{describeActor(row)}</td>
                  <td className="px-5 py-3.5 text-surface-700">{TABLE_LABELS[row.tableName] ?? row.tableName}</td>
                  <td className="px-5 py-3.5">
                    <Pill tone={ACTION_TONES[row.action]}>{ACTION_LABELS[row.action]}</Pill>
                  </td>
                  <td className="px-5 py-3.5 text-surface-500 text-xs" dir="ltr">{row.recordId || '—'}</td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      aria-expanded={expanded === row.id}
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-800 hover:text-primary-900 rounded-lg px-2 py-1 -mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {count(row.changedFields.length)} حقل
                      <ChevronDown size={15} className={`transition-transform ${expanded === row.id ? 'rotate-180' : ''}`} />
                    </button>
                  </td>
                </tr>
                {expanded === row.id && (
                  <tr>
                    <td colSpan={6} className="px-5 pb-4 bg-surface-50/60">
                      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-surface-200/70">
                            {row.action === 'UPDATE'
                              ? Object.entries(row.data as Record<string, { from: unknown; to: unknown }>).map(([field, change]) => (
                                  <tr key={field}>
                                    <td className="px-3 py-2 font-bold text-surface-700 w-40">{field}</td>
                                    <td className="px-3 py-2 text-rose-800 line-through" dir="auto">{short(change?.from)}</td>
                                    <td className="px-3 py-2 text-emerald-800 font-bold" dir="auto">{short(change?.to)}</td>
                                  </tr>
                                ))
                              : Object.entries(row.data).map(([field, value]) => (
                                  <tr key={field}>
                                    <td className="px-3 py-2 font-bold text-surface-700 w-40">{field}</td>
                                    <td className="px-3 py-2 text-surface-700" colSpan={2} dir="auto">{short(value)}</td>
                                  </tr>
                                ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-surface-500 mt-2">
                        معرّف المعاملة: <span dir="ltr" className="tabular-nums">{row.txid}</span> — العمليات التي تحمل نفس المعرّف حدثت معاً.
                      </p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </DataTable>
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />
        </Card>
      )}
    </div>
  );
};
