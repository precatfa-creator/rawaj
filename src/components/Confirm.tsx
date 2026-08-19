import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal, dangerButton, ghostButton, primaryButton } from './Modal';
import type { WriteResult } from '../lib/mutations';

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<WriteResult>;
  onClose: () => void;
}

/** Destructive actions get a confirmation, and a failed delete says why. */
export const Confirm: React.FC<ConfirmProps> = ({
  open, title, message, confirmLabel, onConfirm, onClose,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => { setError(''); onClose(); };

  const run = async () => {
    setBusy(true);
    setError('');
    const result = await onConfirm();
    setBusy(false);
    if (result.ok) close();
    else setError(result.message ?? "");
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <button type="button" onClick={run} disabled={busy} className={dangerButton}>
            {busy ? 'جارٍ التنفيذ…' : confirmLabel}
          </button>
          <button type="button" onClick={close} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <p className="text-surface-700">{message}</p>
      {error && <ErrorNote message={error} />}
    </Modal>
  );
};

/**
 * Asks for a sentence before an irreversible-looking change goes through.
 *
 * Cancelling or returning an order is the change nobody can reconstruct later:
 * the row says the trip ended, and only the person doing it knows why. The
 * reason is required rather than optional, because an empty one is what every
 * one of these ends up being when it is allowed to be.
 */
export const ReasonPrompt: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Danger styling for cancellation; the quieter primary for a return. */
  tone?: 'danger' | 'primary';
  onSubmit: (reason: string) => Promise<WriteResult>;
  onClose: () => void;
}> = ({ open, title, message, confirmLabel, tone = 'danger', onSubmit, onClose }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError('');
    // The dialog exists to collect this one sentence, so the caret starts in it.
    const timer = setTimeout(() => field.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const close = () => { setError(''); onClose(); };

  const submit = async () => {
    const text = reason.trim();
    if (!text) {
      setError('اكتب السبب قبل المتابعة.');
      field.current?.focus();
      return;
    }
    setBusy(true);
    const result = await onSubmit(text);
    setBusy(false);
    if (result.ok) close();
    else setError(result.message ?? '');
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={tone === 'danger' ? dangerButton : primaryButton}
          >
            {busy ? 'جارٍ الحفظ…' : confirmLabel}
          </button>
          <button type="button" onClick={close} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <p className="text-surface-700">{message}</p>
      <label className="block mt-4">
        <span className="block text-sm font-bold text-surface-700 mb-1.5">السبب</span>
        <textarea
          ref={field}
          value={reason}
          onChange={event => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="مثال: العميل ألغى الطلب بعد الاتصال به…"
          className="w-full bg-white border border-surface-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
        />
      </label>
      {error && <ErrorNote message={error} />}
    </Modal>
  );
};

export const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div role="alert" className="mt-4 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3">
    <AlertCircle size={18} className="shrink-0 mt-0.5" />
    <p className="font-bold text-sm">{message}</p>
  </div>
);
