import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { matchesSearch } from '../lib/arabic';

export interface Option {
  value: string;
  label: string;
  /** Optional second line, e.g. a city or a price. */
  hint?: string;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /**
   * When present the list is fetched per keystroke instead of filtered locally,
   * so a picker is never limited to a preloaded slice of the table.
   */
  onSearch?: (term: string) => Promise<Option[]>;
  label: string;
  placeholder?: string;
  /** Renders the label visually; otherwise it is screen-reader only. */
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
  /** Compact variant for use inside table cells. */
  size?: 'md' | 'sm';
  /** Applied to the closed button, e.g. a status colour. */
  tone?: string;
}

/**
 * Type-to-filter select. The listbox is portaled to <body> with fixed coords
 * because these are used inside `overflow-x-auto` table cells, where an inline
 * popup would be clipped — the one thing a native <select> got for free.
 */
export const Combobox: React.FC<ComboboxProps> = ({
  value, onChange, options, onSearch, label, placeholder = 'اختر…', showLabel, disabled,
  className = '', size = 'md', tone,
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [remote, setRemote] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);

  // Debounced server lookup; local filtering stays the default.
  useEffect(() => {
    if (!onSearch || !open) return;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const results = await onSearch(query);
      setRemote(results);
      setSearching(false);
    }, 200);
    return () => { window.clearTimeout(timer); setSearching(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, !!onSearch]);

  const pool = onSearch ? remote : options;
  const selected = options.find(option => option.value === value) ?? remote.find(option => option.value === value);
  const filtered = onSearch
    ? pool
    : query
      ? pool.filter(option => matchesSearch(option.label, query) || matchesSearch(option.hint ?? '', query))
      : pool;

  const place = () => setRect(anchorRef.current?.getBoundingClientRect() ?? null);

  /**
   * A <dialog> opened with showModal() lives in the browser's top layer, and
   * anything portaled to <body> paints underneath it and cannot be clicked. So
   * the popup goes into the dialog when there is one, and to <body> otherwise —
   * still escaping the `overflow-x-auto` table cells that made a portal
   * necessary in the first place.
   */
  const portalTarget = anchorRef.current?.closest('dialog') ?? document.body;

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScrollOrResize = () => place();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !listRef.current?.parentElement?.contains(target)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    anchorRef.current?.focus();
  };

  const commit = (option: Option) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
    anchorRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault(); setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault(); setActiveIndex(filtered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const trigger = size === 'sm'
    ? 'px-3 py-1.5 text-xs rounded-lg gap-1.5'
    : 'px-4 py-2.5 text-sm rounded-xl gap-2';

  return (
    <div className={className}>
      <label
        htmlFor={`${id}-button`}
        className={showLabel ? 'block text-sm font-bold text-surface-700 mb-1.5' : 'sr-only'}
      >
        {label}
      </label>
      <button
        ref={anchorRef}
        id={`${id}-button`}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`w-full inline-flex items-center justify-between font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${trigger} ${
          tone ?? 'bg-white border border-surface-200 text-surface-900 hover:border-surface-300'
        }`}
      >
        <span className={`truncate ${selected ? '' : 'text-surface-500 font-medium'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={size === 'sm' ? 14 : 18} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && createPortal(
        <div
          dir="rtl"
          style={{
            position: 'fixed',
            top: Math.min(rect.bottom + 6, window.innerHeight - 300),
            right: window.innerWidth - rect.right,
            width: Math.max(rect.width, 220),
            zIndex: 1000,
          }}
          className="rounded-2xl border border-surface-200 bg-white shadow-2xl shadow-surface-900/10 overflow-hidden"
        >
          <div className="relative border-b border-surface-100">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input
              // Focus on mount: the portal renders a tick after `open` flips, so a
              // focus() call in the open-effect would run before this exists.
              ref={node => { inputRef.current = node; node?.focus(); }}
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="اكتب للبحث…"
              aria-label={`ابحث في ${label}`}
              aria-controls={`${id}-listbox`}
              aria-activedescendant={filtered[activeIndex] ? `${id}-opt-${filtered[activeIndex].value}` : undefined}
              className="w-full bg-transparent py-2.5 pr-9 pl-3 text-sm font-medium focus:outline-none placeholder:text-surface-400"
            />
          </div>

          <ul ref={listRef} id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-surface-500">
                {searching ? 'جارٍ البحث…' : 'لا توجد نتائج'}
              </li>
            )}
            {filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li key={option.value} role="none">
                  <button
                    type="button"
                    role="option"
                    id={`${id}-opt-${option.value}`}
                    aria-selected={isSelected}
                    data-active={isActive}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={`w-full flex items-center gap-2 text-right px-3 py-2.5 rounded-xl transition-colors ${
                      isActive ? 'bg-primary-50 text-primary-900' : 'text-surface-700'
                    }`}
                  >
                    <Check size={16} className={`shrink-0 ${isSelected ? 'text-primary-700' : 'opacity-0'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm truncate">{option.label}</span>
                      {option.hint && <span className="block text-xs text-surface-500 truncate">{option.hint}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        portalTarget,
      )}
    </div>
  );
};
