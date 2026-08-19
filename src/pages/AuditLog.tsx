import React, { useState } from 'react';
import { describeActor, useActorNames } from '../lib/actors';
import { auditChanges, auditSummary } from '../lib/auditText';
import { ShieldCheck, Info, ChevronDown } from 'lucide-react';
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
  stock_entries: 'حركات المخزون',
  sales_reps: 'المندوبين',
  categories: 'التصنيفات',
  delivery_zones: 'مناطق التوصيل',
  document_naming: 'تسمية المستندات',
  profiles: 'المستخدمون',
};

/** What one row of each table is called, for the "أنشأ …" line. */
const TABLE_RECORDS: Record<string, string> = {
  stores: 'متجراً',
  products: 'منتجاً',
  customers: 'عميلاً',
  orders: 'طلباً',
  stock_entries: 'حركة مخزون',
  sales_reps: 'مندوباً',
  categories: 'تصنيفاً',
  delivery_zones: 'منطقة توصيل',
  document_naming: 'قاعدة تسمية',
  profiles: 'مستخدماً',
};

/** Tables that never belong to a store, so a store's filter must not offer them. */
const GLOBAL_TABLES = ['profiles'];

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

interface AuditLogProps extends PagedProps {
  /**
   * The store whose trail this is. `null` is the portal's view: the changes no
   * store owns — user accounts, and records deleted since they were edited. The
   * two views are disjoint, so nothing is listed twice and nothing is hidden.
   */
  storeId: string | null;
}

export const AuditLog: React.FC<AuditLogProps> = ({ page, onPage, storeId }) => {
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const actors = useActorNames();

  const list = usePagedList<AuditRow>({
    table: 'audit_log',
    columns: 'id,tableName:table_name,recordId:record_id,action,actorId:actor_id,actorRole:actor_role,txid,changedAt:changed_at,changedFields:changed_fields,data',
    match: { store_id: storeId ?? undefined, table_name: table || undefined, action: action || undefined },
    isNull: storeId ? undefined : 'store_id',
    orderBy: 'changed_at',
    page,
  });

  const tableOptions = Object.entries(TABLE_LABELS)
    .filter(([value]) => (storeId ? !GLOBAL_TABLES.includes(value) : true));

  const actorName = (row: AuditRow) => describeActor(row, actors);

  return (
    <div className="space-y-6">
      <PageHead
        title={storeId ? 'سجل التدقيق' : 'سجل النظام'}
        subtitle={storeId
          ? 'كل إضافة وتعديل وحذف في هذا المتجر، مسجّلة تلقائياً ومنسوبة لمن قام بها.'
          : 'التغييرات التي لا تخص متجراً بعينه: حسابات المستخدمين، وسجلات حُذفت بعد تعديلها.'}
      >
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
            ...tableOptions.map(([value, label]) => ({ value, label }))]}
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
          <DataTable headers={['الوقت', 'المستخدم', 'الجدول', 'العملية', 'ما الذي تغيّر', 'التفاصيل']}>
            {list.rows.map(row => {
              const changes = auditChanges(row.action, row.data);
              return (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-surface-50/60 transition-colors">
                  <td className="px-5 py-3.5 text-surface-600 whitespace-nowrap tabular-nums">
                    {new Date(row.changedAt).toLocaleString('ar-LY')}
                  </td>
                  <td className="px-5 py-3.5 font-bold text-surface-900">{actorName(row)}</td>
                  <td className="px-5 py-3.5 text-surface-700">{TABLE_LABELS[row.tableName] ?? row.tableName}</td>
                  <td className="px-5 py-3.5">
                    <Pill tone={ACTION_TONES[row.action]}>{ACTION_LABELS[row.action]}</Pill>
                  </td>
                  {/* The sentence, not the column names: this is the cell
                      somebody actually reads the log for. */}
                  <td className="px-5 py-3.5 text-surface-800 max-w-96">
                    <span className="block truncate" title={auditSummary(row.action, changes, TABLE_RECORDS[row.tableName] ?? 'السجل')}>
                      {auditSummary(row.action, changes, TABLE_RECORDS[row.tableName] ?? 'السجل')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      aria-expanded={expanded === row.id}
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-800 hover:text-primary-900 rounded-lg px-2 py-1 -mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {count(changes.length)} حقل
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
                            {changes.map(change => (
                              <tr key={change.field}>
                                <td className="px-3 py-2 font-bold text-surface-700 w-40">{change.label}</td>
                                {change.from === null ? (
                                  <td className="px-3 py-2 text-surface-700" colSpan={2} dir="auto">{change.to}</td>
                                ) : (
                                  <>
                                    <td className="px-3 py-2 text-surface-400 line-through" dir="auto">{change.from}</td>
                                    <td className="px-3 py-2 text-surface-900 font-bold" dir="auto">{change.to}</td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-surface-500 mt-2">
                        السجل <span dir="ltr" className="tabular-nums">{row.recordId || '—'}</span> · معرّف المعاملة:{' '}
                        <span dir="ltr" className="tabular-nums">{row.txid}</span> — العمليات التي تحمل نفس المعرّف حدثت معاً.
                      </p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
          </DataTable>
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />
        </Card>
      )}
    </div>
  );
};
