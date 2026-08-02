import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Rendered in the footer; the form's submit button belongs here. */
  footer?: React.ReactNode;
  wide?: boolean;
}

/**
 * Native <dialog> + showModal(), which gives focus trapping, Escape-to-close and
 * top-layer stacking without hand-rolling any of them.
 */
export const Modal: React.FC<ModalProps> = ({ open, title, onClose, children, footer, wide }) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <dialog
      ref={ref}
      dir="rtl"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === ref.current) onClose(); }}
      /* m-auto restores the centering that Tailwind's preflight strips off <dialog>. */
      className={`${wide ? 'w-[min(46rem,92vw)]' : 'w-[min(32rem,92vw)]'} m-auto max-h-[86vh] p-0 rounded-3xl border border-surface-200 bg-white text-surface-900 shadow-2xl backdrop:bg-surface-900/40 backdrop:backdrop-blur-sm open:flex open:flex-col`}
    >
      <div className="flex items-start justify-between gap-3 p-5 border-b border-surface-200 shrink-0">
        <h2 className="text-lg font-black">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-surface-100 text-surface-600 hover:text-surface-900 hover:bg-surface-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-5 overflow-y-auto flex-1">{children}</div>

      {footer && (
        <div className="p-5 border-t border-surface-200 flex flex-wrap gap-3 justify-start shrink-0">
          {footer}
        </div>
      )}
    </dialog>
  );
};

export const fieldClass =
  'w-full bg-white border border-surface-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({
  label, children, hint,
}) => (
  <label className="block">
    <span className="block text-sm font-bold text-surface-700 mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-xs text-surface-500 mt-1">{hint}</span>}
  </label>
);

export const primaryButton =
  'inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold px-5 py-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

export const ghostButton =
  'inline-flex items-center justify-center gap-2 bg-white border border-surface-200 hover:bg-surface-100 text-surface-700 font-bold px-5 py-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

export const dangerButton =
  'inline-flex items-center justify-center gap-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2';
