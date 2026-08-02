import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal, dangerButton, ghostButton } from './Modal';
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
            {busy ? 'جارٍ التنفيذ...' : confirmLabel}
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

export const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div role="alert" className="mt-4 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3">
    <AlertCircle size={18} className="shrink-0 mt-0.5" />
    <p className="font-bold text-sm">{message}</p>
  </div>
);
