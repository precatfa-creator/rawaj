import React from 'react';
import { Check, CircleDot, RotateCcw, XCircle } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { estimatedDeliveryDate, TRACK_STEPS, trackingState } from '../lib/tracking';
import type { DeliveryZone, Order, SalesRep } from '../types';

/** A stage the order actually passed, as recorded by the audit trail. */
export interface StatusEvent {
  status: string;
  at: string;
  by: string;
}

const stamp = new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const longDay = new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The delivery journey as a ladder, read top to bottom.
 *
 * Vertical, not the horizontal band it used to be, for two reasons: it lives in
 * a column beside the order now, and every rung carries the moment it happened
 * and who moved it there. Those come from the audit trail — the orders table
 * keeps one status, not a history — so a step with no recorded moment prints
 * the stage alone rather than inventing a date for it.
 */
/**
 * Cancellation is a failure and reads red; a return is a normal, if unwanted,
 * end to the trip — the goods came back — and reads amber.
 */
const HALT_TONES = {
  canceled: {
    marker: 'bg-rose-600 border-rose-600 text-white',
    banner: 'border-rose-100 bg-rose-50 text-rose-800',
    detail: 'text-rose-700',
    line: 'bg-rose-300',
  },
  returned: {
    marker: 'bg-amber-500 border-amber-500 text-white',
    banner: 'border-amber-200 bg-amber-50 text-amber-900',
    detail: 'text-amber-800',
    line: 'bg-amber-300',
  },
} as const;

export const OrderTracking: React.FC<{
  order: Order;
  rep?: SalesRep;
  zone?: DeliveryZone;
  /** Status changes from the audit log, oldest first. Empty is normal: the log
      is admin-only, so most people see the ladder without moments. */
  events?: StatusEvent[];
}> = ({ order, rep, zone, events = [] }) => {
  const state = trackingState(order.status);
  const still = useReducedMotion();
  const halted = state.halted !== null;
  const tone = state.halted ? HALT_TONES[state.halted] : null;
  const expected = estimatedDeliveryDate(order, zone?.deliveryTimeDays);

  const firstReached = (status: string) => events.find(event => event.status === status);
  const halt = halted ? events.find(event => event.status === order.status) : undefined;

  return (
    <section aria-label="سير الطلب" className="rounded-2xl border border-surface-200 bg-white overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-surface-200 bg-surface-50">
        <h3 className="font-black text-sm text-surface-900">سير الطلب</h3>
        <p className="text-xs text-surface-500">
          {expected ? `التسليم المتوقع ${longDay.format(new Date(`${expected}T00:00:00.000Z`))}` : 'بلا موعد تسليم'}
        </p>
      </header>

      <ol className="relative px-4 py-4">
        {TRACK_STEPS.map((step, index) => {
          const reached = index <= state.index && !(halted && state.halted === 'canceled' && index > 0);
          const current = !halted && index === state.index;
          const event = firstReached(step.status);
          const last = index === TRACK_STEPS.length - 1;
          return (
            <li key={step.status} className="relative flex gap-3 pb-5 last:pb-0">
              {/* The rail runs between markers, so the last rung has none. */}
              {!last && (
                <span
                  aria-hidden
                  className={`absolute top-7 bottom-0 right-3 w-px ${
                    reached ? tone?.line ?? 'bg-primary-300' : 'bg-surface-200'
                  }`}
                />
              )}
              <motion.span
                aria-hidden
                initial={still ? false : { scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: still ? 0 : 0.25, delay: still ? 0 : index * 0.06 }}
                className={`relative z-10 mt-0.5 grid place-items-center w-6 h-6 shrink-0 rounded-full border-2 ${
                  reached
                    ? tone?.marker ?? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white border-surface-300 text-transparent'
                } ${current ? 'ring-4 ring-primary-100' : ''}`}
              >
                {current ? <CircleDot size={13} /> : <Check size={13} />}
              </motion.span>

              <div className="min-w-0 -mt-0.5">
                <p className={`text-sm font-bold ${reached ? 'text-surface-900' : 'text-surface-400'}`}>
                  {step.label}
                </p>
                {event ? (
                  <p className="text-xs text-surface-500 mt-0.5">
                    <span className="tabular-nums">{stamp.format(new Date(event.at))}</span>
                    {event.by && <span> · {event.by}</span>}
                  </p>
                ) : (
                  reached && <p className="text-xs text-surface-400 mt-0.5">بلا وقت مسجّل</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {halted && (
        <p role="status" className="flex items-start gap-2 border-t border-rose-100 bg-rose-50 text-rose-800 font-bold text-sm px-4 py-3">
          <XCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            {state.halted === 'canceled' ? 'أُلغي هذا الطلب ولم يكتمل التسليم.' : 'أُرجع هذا الطلب بعد التسليم.'}
            {halt && (
              <span className="block font-medium text-rose-700 mt-0.5 tabular-nums">
                {stamp.format(new Date(halt.at))}{halt.by && ` · ${halt.by}`}
              </span>
            )}
          </span>
        </p>
      )}

      <footer className="border-t border-surface-200 px-4 py-3 text-xs text-surface-600 flex items-center justify-between gap-3">
        <span>المندوب</span>
        <span className="font-bold text-surface-900 truncate">{rep?.name ?? 'بدون مندوب'}</span>
      </footer>
    </section>
  );
};
