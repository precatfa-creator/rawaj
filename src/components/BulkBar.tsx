import React, { useEffect, useId, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { ErrorNote } from './Confirm';
import { exportSheet, importSheet, type BulkSpec, type ImportReport, type SheetFormat } from '../lib/bulk';

/**
 * Import/export, folded into a popover.
 *
 * It used to be a permanent card: four buttons and a paragraph of format notes,
 * holding the top of every list page for a job people do occasionally. The
 * actions now live behind one control, and the notes travel with them — the
 * page gets its space back, and the explanation appears exactly when somebody
 * is about to need it.
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
  const panelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);

  // Same dismissal contract as Combobox: a click anywhere else, or Escape.
  // Kept off while closed so the page carries no idle listeners.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const download = async (format: SheetFormat, withData: boolean) => {
    setBusy('export'); setError(''); setReport(null);
    try {
      await exportSheet(spec, format, withData);
      setOpen(false);
    } catch (cause) {
      console.error('export failed', cause);
      setError('تعذر إنشاء الملف.');
    }
    setBusy('');
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import'); setError(''); setReport(null);
    setOpen(false);
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
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          // The control is an icon, so the name it exposes has to come from here.
          aria-label={title}
          title={title}
          className={`inline-flex items-center justify-center gap-2 h-11 px-3 rounded-xl border font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
            open
              ? 'bg-primary-50 border-primary-300 text-primary-800'
              : 'bg-white border-surface-200 text-surface-700 hover:bg-surface-50 hover:border-surface-300'
          }`}
        >
          {working ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
        </button>

        {open && (
          <div
            id={panelId}
            className="absolute z-30 mt-2 end-0 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-surface-200 bg-white shadow-xl shadow-surface-900/10 p-2"
          >
            <div className="flex items-center gap-2 px-2 pt-1 pb-2">
              <h3 className="font-black text-sm text-surface-900">{title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
                className="ms-auto inline-flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X size={16} />
              </button>
            </div>

            <label htmlFor={inputId} className={`${bulkItem} cursor-pointer ${working ? 'opacity-60 pointer-events-none' : ''}`}>
              <Upload size={16} className="text-primary-700 shrink-0" />
              <span className="font-bold">{busy === 'import' ? 'جارٍ الاستيراد…' : 'استيراد من ملف'}</span>
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

            <button type="button" disabled={working} onClick={() => void download('xlsx', true)} className={bulkItem}>
              <Download size={16} className="text-primary-700 shrink-0" />
              <span className="font-bold">تصدير Excel</span>
              <span className="ms-auto text-xs text-surface-500">xlsx</span>
            </button>
            <button type="button" disabled={working} onClick={() => void download('csv', true)} className={bulkItem}>
              <Download size={16} className="text-primary-700 shrink-0" />
              <span className="font-bold">تصدير CSV</span>
              <span className="ms-auto text-xs text-surface-500">csv</span>
            </button>
            <button type="button" disabled={working} onClick={() => void download('xlsx', false)} className={bulkItem}>
              <FileSpreadsheet size={16} className="text-surface-400 shrink-0" />
              <span className="font-bold">قالب فارغ</span>
            </button>

            <p className="text-xs text-surface-600 leading-relaxed border-t border-surface-200 mt-2 pt-2 px-2 pb-1">
              {hint}
            </p>
          </div>
        )}
      </div>

      {/* Outside the popover on purpose: the result of an import has to survive
          the panel closing, which is the first thing that happens after one. */}
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
    </>
  );
};

const bulkItem =
  'w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm text-surface-800 text-start hover:bg-surface-100 disabled:opacity-50 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';
