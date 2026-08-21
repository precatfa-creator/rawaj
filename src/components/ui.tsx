import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Modal } from './Modal';

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

/**
 * One cached formatter rather than one per call: these run once per money cell,
 * and `Intl.NumberFormat` is expensive to construct.
 *
 * Latin digits on purpose — the app is Arabic, but the operators read order
 * totals against Latin-digit invoices and bank statements.
 */
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const money = (value: number) => `${decimal.format(value)} د.ل`;
export const count = (value: number) => decimal.format(value);
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


/**
 * A picture, or the name standing in for one.
 *
 * A missing image used to render an empty grey square, which reads as "broken"
 * or "still loading" rather than "this one has no photo". Initials on a tinted
 * ground say the second thing, and — unlike a generic icon — two products
 * without photos still look like different products.
 *
 * `onError` matters as much as the empty check: an image URL survives the file
 * being deleted from storage, so a truthy `src` is not proof of a picture. Both
 * failures land on the same fallback.
 */
const AVATAR_TONES = [
  'bg-primary-100 text-primary-800',
  'bg-blue-100 text-blue-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
];

/** Stable per name, so a product keeps the same colour between renders. */
export const toneFor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
};

/** First letter of each of the first two words — enough to tell things apart. */
export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('') || '؟';

export const Thumb: React.FC<{
  src?: string;
  /** Names the image for assistive tech, and supplies the fallback initials. */
  name: string;
  /** Tailwind sizing for the box, e.g. `w-11 h-11`. */
  className?: string;
  /** Bigger boxes carry bigger initials. */
  textClass?: string;
  /** `contain` for a product shot that must be seen whole; `cover` for a chip. */
  fit?: 'cover' | 'contain';
}> = ({ src, name, className = 'w-11 h-11', textClass = 'text-sm', fit = 'cover' }) => {
  const [failed, setFailed] = useState(false);
  const box = `${className} rounded-lg border border-surface-200 shrink-0 overflow-hidden`;

  // Editing a product can replace a broken URL without remounting its row.
  // Give the new source its own attempt instead of preserving the old failure.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={name}
        className={`${box} ${toneFor(name)} grid place-items-center font-black ${textClass}`}
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${box} ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  );
};

const lightboxArrow =
  'absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full grid place-items-center bg-white/90 border border-surface-200 text-surface-700 hover:text-surface-900 hover:bg-white shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * Full-screen viewer for a product's photos.
 *
 * Built on the existing fullscreen `Modal` rather than a hand-rolled overlay:
 * that already gives the top-layer stacking, focus trap and Escape-to-close
 * this needs, and keeps the close button in the same place as every other
 * dialog in the app.
 *
 * The index lives here and resets on open, so a caller only has to say which
 * product is being looked at.
 */
export const Lightbox: React.FC<{
  images: string[];
  /** Names the image for assistive tech and titles the dialog. */
  name: string;
  open: boolean;
  onClose: () => void;
}> = ({ images, name, open, onClose }) => {
  const [index, setIndex] = useState(0);

  // A second product can be opened without the dialog closing in between.
  useEffect(() => { if (open) setIndex(0); }, [open, images]);

  // Wraps in both directions: at the last photo "next" is the first one, so
  // the arrows never dead-end on a short gallery.
  const step = (by: number) => setIndex(i => (i + by + images.length) % images.length);

  useEffect(() => {
    if (!open || images.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      // Reading runs right-to-left here, so the left arrow advances.
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, images.length]);

  const src = images[index];

  return (
    <Modal
      open={open}
      title={images.length > 1 ? `${name} — ${index + 1}/${images.length}` : name}
      onClose={onClose}
      fullscreen
    >
      <div className="h-full flex flex-col gap-4">
        <div className="flex-1 min-h-0 relative flex items-center justify-center">
          {src ? (
            <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
          ) : (
            <span
              role="img"
              aria-label={name}
              className={`w-40 h-40 rounded-3xl grid place-items-center font-black text-6xl ${toneFor(name)}`}
            >
              {initialsOf(name)}
            </span>
          )}

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="الصورة السابقة"
                className={`${lightboxArrow} right-2`}
              >
                <ChevronRight size={22} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="الصورة التالية"
                className={`${lightboxArrow} left-2`}
              >
                <ChevronLeft size={22} />
              </button>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div className="shrink-0 flex gap-2 overflow-x-auto pb-1">
            {images.map((image, i) => (
              <button
                key={`${image}-${i}`}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`الصورة ${i + 1}`}
                aria-current={i === index}
                className={`rounded-lg overflow-hidden shrink-0 border-2 transition-colors ${
                  i === index ? 'border-primary-600' : 'border-transparent hover:border-surface-300'
                }`}
              >
                <Thumb src={image} name={name} className="w-16 h-16" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
