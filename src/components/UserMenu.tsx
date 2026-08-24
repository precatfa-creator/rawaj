import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from './ui';
import type { Profile } from '../types';

export interface UserMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Destructive entries render in the rose palette, e.g. signing out. */
  danger?: boolean;
}

interface UserMenuProps {
  profile: Profile;
  /** Rendered top to bottom with a hairline between groups. */
  sections: UserMenuItem[][];
}

/**
 * The account menu: one trigger for everything that belongs to the person
 * rather than the store.
 *
 * The trigger is the avatar — the thing the user already recognises as
 * "mine" — so the header carries two controls instead of seven, and each
 * remaining one is legible at reading pace instead of icon-guessing.
 *
 * Keyboard contract follows the menu pattern: Escape closes and returns focus
 * to the trigger, arrows walk the items, clicking outside dismisses.
 */
export const UserMenu: React.FC<UserMenuProps> = ({ profile, sections }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus lands on the first item so arrows work immediately and a screen
  // reader announces the menu rather than the page behind it.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[(index + 1) % buttons.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttons[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttons[buttons.length - 1].focus();
    }
  };

  const choose = (item: UserMenuItem) => {
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(current => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`قائمة الحساب — ${profile.displayName}`}
        title={profile.displayName}
        className="flex items-center gap-1 rounded-2xl p-1 ps-1.5 text-surface-500 transition-colors hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <Avatar
          src={profile.avatarUrl}
          name={profile.displayName || profile.email}
          className="w-10 h-10"
        />
        <ChevronDown size={15} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label="قائمة الحساب"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          className="absolute end-0 top-full mt-2 w-64 rounded-2xl border border-surface-200/80 bg-white/95 backdrop-blur-xl shadow-xl shadow-surface-900/10 p-2 z-50 origin-top"
        >
          <div className="px-3 pt-2 pb-3 mb-1.5 border-b border-surface-100">
            <p className="font-black text-sm text-surface-900 truncate">{profile.displayName}</p>
            <p className="text-xs text-surface-500 truncate mt-0.5" dir="ltr">{profile.email}</p>
          </div>
          {sections.map((section, sectionIndex) => (
            <div
              key={sectionIndex}
              className={sectionIndex > 0 ? 'mt-1.5 pt-1.5 border-t border-surface-100' : ''}
            >
              {section.map(item => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(item)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    item.danger
                      ? 'text-rose-600 hover:bg-rose-50'
                      : 'text-surface-700 hover:bg-surface-100 hover:text-surface-900'
                  }`}
                >
                  <item.icon size={17} aria-hidden className={item.danger ? '' : 'text-surface-400'} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
};
