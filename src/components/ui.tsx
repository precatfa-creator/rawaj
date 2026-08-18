import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A short identifier that copies itself when clicked.
 *
 * Store codes get read out over the phone and pasted into the linking form, so
 * the useful action on one is "copy", not "select carefully with the mouse".
 * The whole thing is the button rather than a separate icon beside it — a
 * 10-character code is a small target, and the icon doubles as the affordance.
 *
 * `navigator.clipboard` is missing on an insecure origin, so failure is a real
 * state and says so instead of silently doing nothing.
 */
export const CopyableCode: React.FC<{
  value: string;
  /** `dark` sits on a photo overlay, `light` on a normal surface. */
  tone?: 'light' | 'dark';
  className?: string;
}> = ({ value, tone = 'light', className = '' }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  // The timeout outlives the component when a card unmounts mid-countdown.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!value) return null;

  const copy = async (event: React.MouseEvent) => {
    // Card codes sit on top of the button that opens the store; copying the id
    // must not also navigate into it.
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };

  const tones = tone === 'dark'
    ? 'text-surface-200 hover:text-white hover:bg-white/15 focus-visible:ring-white/70'
    : 'text-surface-500 hover:text-primary-800 hover:bg-surface-100 focus-visible:ring-primary-500';

  return (
    <button
      type="button"
      onClick={copy}
      title={`نسخ ${value}`}
      aria-label={`نسخ معرّف المتجر ${value}`}
      className={`inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -mx-1.5 font-mono text-xs
        transition-colors focus-visible:outline-none focus-visible:ring-2 ${tones} ${className}`}
    >
      <span dir="ltr">{value}</span>
      {state === 'copied'
        ? <Check size={13} className="shrink-0 text-emerald-400" />
        : <Copy size={13} className="shrink-0 opacity-70" />}
      {/* Announced, and shown, only once there is something to say. */}
      <span aria-live="polite" className="font-sans font-bold">
        {state === 'copied' ? 'تم النسخ' : state === 'failed' ? 'تعذر النسخ' : ''}
      </span>
    </button>
  );
};

/** Page header used by every store page. */
export const PageHead: React.FC<{ title: string; subtitle: string; children?: React.ReactNode }> = ({
  title, subtitle, children,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h2 className="text-3xl font-black text-surface-900 tracking-tight">{title}</h2>
      <p className="text-surface-500 mt-1">{subtitle}</p>
    </div>
    {children}
  </div>
);

export const actionButton =
  'inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-bold shadow-sm shadow-primary-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

export const quietButton =
  'inline-flex items-center justify-center gap-2 bg-white border border-surface-200 hover:bg-surface-50 hover:border-surface-300 text-surface-700 px-4 py-2.5 rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

/** Card with a soft gradient wash instead of a flat panel. */
export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-surface-200/80 bg-gradient-to-b from-white to-surface-50/60 shadow-sm shadow-surface-900/[0.03] ${className}`}>
    {children}
  </div>
);

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }> = ({
  icon, title, body, children,
}) => (
  <Card className="p-12 text-center">
    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-50 to-surface-100 border border-surface-200/70 flex items-center justify-center mx-auto mb-4 text-primary-700">
      {icon}
    </div>
    <h3 className="text-lg font-black text-surface-900 mb-1">{title}</h3>
    <p className="text-surface-500 mb-5 max-w-sm mx-auto">{body}</p>
    {children}
  </Card>
);

/** Big number with a label; the workhorse of the finance and report pages. */
export const Metric: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
  icon?: React.ReactNode;
}> = ({ label, value, hint, tone = 'default', icon }) => {
  const valueTone =
    tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-rose-700' : 'text-surface-900';
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="absolute -left-8 -top-8 w-24 h-24 rounded-full bg-primary-100/40 blur-2xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-surface-500 truncate">{label}</p>
          <p className={`text-2xl font-black mt-1.5 tabular-nums ${valueTone}`}>{value}</p>
          {hint && <p className="text-xs text-surface-500 mt-1.5">{hint}</p>}
        </div>
        {icon && (
          <span className="shrink-0 w-10 h-10 rounded-xl bg-white border border-surface-200 grid place-items-center text-primary-700">
            {icon}
          </span>
        )}
      </div>
    </Card>
  );
};

/** Table shell: sticky head, zebra-free, hairline dividers. */
export const DataTable: React.FC<{
  headers: string[];
  children: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: boolean;
}> = ({ headers, children, empty, isEmpty }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm text-right">
      <thead>
        <tr className="bg-surface-50/80 border-b border-surface-200">
          {headers.map(header => (
            <th key={header} className="px-5 py-3.5 font-bold text-xs uppercase tracking-wide text-surface-500 whitespace-nowrap">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-200/70">{children}</tbody>
    </table>
    {isEmpty && <div className="p-10 text-center text-surface-500">{empty}</div>}
  </div>
);

export const Pill: React.FC<{ children: React.ReactNode; tone?: string }> = ({ children, tone }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${tone ?? 'bg-surface-100 text-surface-700 border-surface-200'}`}>
    {children}
  </span>
);

export const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;
export const count = (value: number) => value.toLocaleString('en-US');
export const percent = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

/** Page bar. Reports the server-side total, not the size of the loaded page. */
export const Pagination: React.FC<{
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  loading?: boolean;
}> = ({ page, total, pageSize, onPage, loading }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  const button =
    'inline-flex items-center justify-center min-w-10 h-10 px-3 rounded-xl border border-surface-200 bg-white text-sm font-bold text-surface-700 transition-colors hover:bg-surface-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  // A short window around the current page keeps the bar usable at any length.
  const window: number[] = [];
  const start = Math.max(0, Math.min(page - 2, pages - 5));
  for (let i = start; i < Math.min(pages, start + 5); i += 1) window.push(i);

  return (
    <nav aria-label="تنقّل بين الصفحات" className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-surface-200/70">
      <p className="text-sm text-surface-500 tabular-nums" aria-live="polite">
        {first}–{last} من {total.toLocaleString('en-US')}
        {loading && <span className="mr-2 text-surface-400">جارٍ التحميل…</span>}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" className={button} onClick={() => onPage(page - 1)} disabled={page === 0 || loading}>
          السابق
        </button>
        {window.map(index => (
          <button
            key={index}
            type="button"
            onClick={() => onPage(index)}
            aria-current={index === page ? 'page' : undefined}
            className={index === page
              ? 'inline-flex items-center justify-center min-w-10 h-10 px-3 rounded-xl bg-primary-700 text-white text-sm font-bold'
              : button}
          >
            {index + 1}
          </button>
        ))}
        <button type="button" className={button} onClick={() => onPage(page + 1)} disabled={page >= pages - 1 || loading}>
          التالي
        </button>
      </div>
    </nav>
  );
};
