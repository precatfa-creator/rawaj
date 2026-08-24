/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Award,
  Code2,
  Github,
  Globe,
  Heart,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const developerInfo = {
  name: 'م. عمر',
  title: 'مطور ومصمم نظام السستم',
  bio: 'مهندس برمجيات متخصص في بناء الحلول الرقمية وتجارب الاستخدام الراقية. طُوّر نظام «السستم» ليجمع إدارة المتاجر والطلبات والعملاء والمالية في مساحة واحدة بسيطة وموثوقة، ويساعد أصحاب الأعمال على اتخاذ قرارات أوضح كل يوم.',
  github: 'https://github.com/omarmail092',
  telegram: 'https://t.me/Omar25Muhammad',
  whatsapp: 'https://wa.me/218945953967',
  phone: '+218 94 595 3967',
  email: 'omarmail092@gmail.com',
  location: 'طرابلس، ليبيا',
};

const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable: HTMLElement[] = Array.from(
        modalRef.current.querySelectorAll(focusableSelector),
      ) as HTMLElement[];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <div className="pointer-events-none fixed inset-0 -z-10 bg-surface-950/50 backdrop-blur-sm" />

          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-modal-title"
            aria-describedby="about-modal-description"
            dir="rtl"
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative my-auto w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-2xl"
          >
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary-300/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-14 h-56 w-56 rounded-full bg-emerald-200/25 blur-3xl" />

            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="إغلاق نافذة عن السستم"
              className="absolute left-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-100 text-surface-500 transition-colors hover:bg-surface-200 hover:text-surface-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X size={18} />
            </button>

            <div className="relative flex max-h-[88dvh] flex-col items-center overflow-y-auto px-5 py-6 text-center sm:px-8 sm:py-8">
              <div className="relative mb-4">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-primary-400 via-primary-500 to-primary-700 p-1 shadow-xl shadow-primary-500/20">
                  <div className="grid h-full w-full place-items-center rounded-full bg-white">
                    <img src="/catfa-logo.svg" alt="شعار السستم" width={44} height={44} className="h-11 w-11" />
                  </div>
                </div>
                <span className="absolute -bottom-1 -left-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-emerald-500 text-white shadow-md">
                  <Code2 size={15} />
                </span>
              </div>

              <div className="mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">
                  <Award size={13} />
                  إصدار مستقر 1.1
                </span>
                <h2 id="about-modal-title" className="mt-3 text-2xl font-black text-surface-900">
                  {developerInfo.name}
                </h2>
                <p className="mt-1 text-sm font-bold text-surface-500">{developerInfo.title}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-surface-400">
                  <MapPin size={12} />
                  {developerInfo.location}
                </p>
              </div>

              <div className="w-full rounded-2xl border border-surface-200/80 bg-surface-50/80 p-4">
                <div className="mb-2 flex items-center justify-center gap-1.5 text-primary-700">
                  <Sparkles size={14} />
                  <span className="text-xs font-black">عن السستم</span>
                </div>
                <p
                  id="about-modal-description"
                  className="text-sm font-medium leading-7 text-surface-600"
                >
                  {developerInfo.bio}
                </p>
              </div>

              <div className="my-5 h-px w-full bg-surface-200" />

              <div className="w-full">
                <p className="mb-3 text-[11px] font-black tracking-wide text-surface-400">
                  قنوات المطور الرسمية
                </p>
                <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-3">
                  <a
                    href={developerInfo.github}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-900 px-3 text-xs font-black text-white transition-transform hover:-translate-y-0.5 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-500 focus-visible:ring-offset-2"
                  >
                    <Github size={16} />
                    GitHub
                  </a>
                  <a
                    href={developerInfo.telegram}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0088cc] px-3 text-xs font-black text-white transition-transform hover:-translate-y-0.5 hover:bg-[#0077b3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0088cc] focus-visible:ring-offset-2"
                  >
                    <Send size={16} />
                    Telegram
                  </a>
                  <a
                    href={developerInfo.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 text-xs font-black text-white transition-transform hover:-translate-y-0.5 hover:bg-[#20ba59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
                  >
                    <MessageCircle size={16} />
                    WhatsApp
                  </a>
                </div>
              </div>

              <div className="mt-5 flex w-full flex-col items-center justify-between gap-2 rounded-2xl bg-surface-50 px-4 py-3 text-xs font-medium text-surface-500 sm:flex-row">
                <a
                  href={`tel:${developerInfo.phone.replace(/\s/g, '')}`}
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 hover:text-primary-700"
                >
                  <Phone size={14} />
                  {developerInfo.phone}
                </a>
                <a
                  href={`mailto:${developerInfo.email}`}
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 hover:text-primary-700"
                >
                  <Globe size={14} />
                  {developerInfo.email}
                </a>
              </div>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs font-bold text-surface-400">
                صُنع بكل
                <Heart size={14} className="fill-rose-500 text-rose-500" />
                شغف لدعم نمو تجارتك
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
