import React from 'react';
import { CheckCircle2, ChevronLeft, ClipboardCheck, FileText, PackageCheck, Truck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { statusLabels } from '../lib/dashboardStats';
import { TRACK_STEPS, trackingState } from '../lib/tracking';
import type { Order, SalesRep } from '../types';

/** One icon per stage, in the same order as `TRACK_STEPS`. */
const STEP_ICONS: LucideIcon[] = [FileText, ClipboardCheck, PackageCheck, Truck, CheckCircle2];

/**
 * The delivery journey as a line, right to left like the rest of the interface.
 *
 * It reads from the order's current status only — see `lib/tracking.ts` — so
 * there are no per-step dates to promise. What it does show is where the order
 * is now, and that is the question the customer on the phone is asking.
 */
export const OrderTracking: React.FC<{ order: Order; rep?: SalesRep }> = ({ order, rep }) => {
  const state = trackingState(order.status);
  const still = useReducedMotion();

  const halted = state.halted !== null;
  const tone = {
    // Cancelled and returned keep the same layout and change only the palette:
    // a differently-shaped panel for the unhappy path is one more thing to read.
    band: halted ? 'from-rose-600 to-rose-500' : 'from-primary-700 to-primary-500',
    meta: halted ? 'bg-rose-50 border-rose-100' : 'bg-primary-50 border-primary-100',
    done: halted ? 'bg-rose-500 border-rose-500' : 'bg-primary-600 border-primary-600',
    line: halted ? 'bg-rose-400' : 'bg-primary-500',
  };

  const meta: Array<[string, string]> = [
    ['المندوب', rep?.name ?? 'بدون مندوب'],
    ['الحالة', statusLabels[order.status] ?? order.status],
    ['التسليم المتوقع', order.deliveryDate
      ? new Date(order.deliveryDate).toLocaleDateString('ar-LY', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'غير محدد'],
  ];

  return (
    <section aria-label="تتبع الطلب" className="rounded-2xl border border-surface-200 overflow-hidden bg-white">
      <h3 className={`bg-gradient-to-l ${tone.band} text-white text-center font-black py-3 px-4`}>
        تتبع الطلب · <span className="font-mono" dir="ltr">{order.orderNumber}</span>
      </h3>

      <dl className={`grid grid-cols-1 sm:grid-cols-3 gap-y-2 gap-x-4 border-b ${tone.meta} px-4 py-3 text-sm text-center sm:text-right`}>
        {meta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="inline font-black text-surface-700">{label}: </dt>
            <dd className="inline text-surface-600">{value}</dd>
          </div>
        ))}
      </dl>

      {/* The list carries the whole state for a screen reader; the circles and
          the line above it are decoration over that. */}
      <ol className="flex items-start px-2 py-6 sm:px-4">
        {TRACK_STEPS.map((step, index) => {
          const Icon = STEP_ICONS[index];
          const reached = !halted || state.halted === 'returned' ? index <= state.index : false;
          const current = !halted && index === state.index;
          return (
            <li key={step.status} className="relative flex-1 flex flex-col items-center gap-2 text-center">
              {index > 0 && (
                <>
                  {/* Spans from this circle's centre to the previous one's — in
                      RTL that is rightwards, which is why it is anchored right. */}
                  <span aria-hidden className="absolute top-5 sm:top-6 right-1/2 w-full h-1 -translate-y-1/2 bg-surface-200 rounded-full" />
                  <motion.span
                    aria-hidden
                    className={`absolute top-5 sm:top-6 right-1/2 w-full h-1 -translate-y-1/2 rounded-full origin-right ${tone.line}`}
                    initial={still ? false : { scaleX: 0 }}
                    animate={{ scaleX: reached ? 1 : 0 }}
                    transition={{ duration: still ? 0 : 0.45, delay: still ? 0 : index * 0.15 }}
                  />
                  <ChevronLeft
                    aria-hidden
                    size={16}
                    className={`absolute top-5 sm:top-6 right-0 translate-x-1/2 -translate-y-1/2 ${
                      reached ? 'text-white' : 'text-surface-400'
                    }`}
                  />
                </>
              )}

              <motion.span
                aria-hidden
                initial={still ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: still ? 0 : 0.3, delay: still ? 0 : index * 0.15 }}
                className={`relative z-10 grid place-items-center w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 border-white shadow-sm ${
                  reached ? `${tone.done} text-white` : 'bg-surface-200 text-surface-500'
                } ${current ? `ring-4 ring-primary-200 ${still ? '' : 'animate-pulse'}` : ''}`}
              >
                <Icon size={20} />
              </motion.span>

              <span className={`text-[0.7rem] sm:text-xs font-bold leading-tight px-0.5 ${
                reached ? 'text-surface-900' : 'text-surface-400'
              }`}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {halted && (
        <p role="status" className="flex items-center justify-center gap-2 border-t border-rose-100 bg-rose-50 text-rose-800 font-bold text-sm px-4 py-3">
          <XCircle size={18} className="shrink-0" />
          {state.halted === 'canceled'
            ? 'أُلغي هذا الطلب ولم يكتمل التسليم.'
            : 'أُرجع هذا الطلب بعد التسليم.'}
        </p>
      )}
    </section>
  );
};
