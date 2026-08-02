import React, { useId, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { ErrorNote } from './Confirm';
import { Card, quietButton } from './ui';
import { exportSheet, importSheet, type BulkSpec, type ImportReport, type SheetFormat } from '../lib/bulk';

/**
 * Import/export strip shared by the zones and items pages.
 *
 * Export and "template with existing data" are deliberately the same file: a
 * populated export IS the pre-filled template, because importing it back is what
 * the round trip is for. Saying so out loud beats offering two buttons that
 * download identical bytes.
 */
export const BulkBar = <T,>({ spec, title, hint }: {
  spec: BulkSpec<T>;
  title: string;
  hint: string;
}) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);

  const download = async (format: SheetFormat, withData: boolean) => {
    setBusy('export'); setError(''); setReport(null);
    try {
      await exportSheet(spec, format, withData);
    } catch (cause) {
      console.error('export failed', cause);
      setError('تعذر إنشاء الملف.');
    }
    setBusy('');
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import'); setError(''); setReport(null);
    try {
      setReport(await importSheet(file, spec));
    } catch (cause) {
      console.error('import failed', cause);
      setError('تعذر قراءة الملف. تأكد أنه بصيغة Excel أو CSV.');
    }
    setBusy('');
    // Re-selecting the same file after a fix must fire `change` again.
    if (inputRef.current) inputRef.current.value = '';
  };

  const working = busy !== '';

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet size={18} className="text-primary-700 shrink-0" />
        <h3 className="font-black text-sm text-surface-900 ml-auto">{title}</h3>

        <label htmlFor={inputId} className={`${quietButton} cursor-pointer ${working ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {busy === 'import' ? 'جارٍ الاستيراد…' : 'استيراد'}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={working}
            onChange={event => void upload(event.target.files?.[0])}
            className="sr-only"
          />
        </label>

        <button type="button" disabled={working} onClick={() => void download('xlsx', true)} className={quietButton}>
          <Download size={16} />
          تصدير Excel
        </button>
        <button type="button" disabled={working} onClick={() => void download('csv', true)} className={quietButton}>
          <Download size={16} />
          تصدير CSV
        </button>
        <button type="button" disabled={working} onClick={() => void download('xlsx', false)} className={quietButton}>
          <Download size={16} />
          قالب فارغ
        </button>
      </div>

      <p className="text-xs text-surface-500 leading-relaxed">{hint}</p>

      {report && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-sm font-bold ${
            report.errors.length > 0
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <p>أُضيف {report.created} · حُدِّث {report.updated} · تعذر {report.errors.length}</p>
          {report.errors.length > 0 && (
            <ul className="mt-2 space-y-1 font-medium max-h-40 overflow-y-auto">
              {report.errors.slice(0, 20).map(item => (
                <li key={item.line}>السطر {item.line}: {item.message}</li>
              ))}
              {report.errors.length > 20 && <li>…و{report.errors.length - 20} أخرى.</li>}
            </ul>
          )}
        </div>
      )}

      {error && <ErrorNote message={error} />}
    </Card>
  );
};
