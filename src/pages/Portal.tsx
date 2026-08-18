import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, BarChart3, SlidersHorizontal, Blocks, Info, Link2, LogOut, Settings, ShieldCheck, Store as StoreIcon } from 'lucide-react';
import { useAppStore } from '../store';
import { supabase } from '../db/supabase';
import { AboutModal } from '../components/AboutModal';
import { Dashboard } from './Dashboard';
import { Stores } from './Stores';
import { AdminUsers } from './AdminUsers';
import type { Profile } from '../types';

export type PortalTab = 'stats' | 'stores';

const TABS: Array<{ id: PortalTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'stats', label: 'الإحصائيات', icon: BarChart3 },
  { id: 'stores', label: 'المتاجر', icon: StoreIcon },
];

interface PortalProps {
  profile: Profile;
  /** Held by the router so the tab is addressable and survives a refresh. */
  tab: PortalTab;
  onTabChange: (tab: PortalTab) => void;
  showUsers: boolean;
  onShowUsers: (show: boolean) => void;
  /** Rendered in place of the tabs by the admin-only system log route. */
  panel?: React.ReactNode;
  onShowAudit: () => void;
  onShowNetwork: () => void;
  onShowDocTypes: () => void;
  onShowSettings: () => void;
  onOpenStore: (storeId: string) => void;
}

/**
 * The first screen after login. Deliberately holds two destinations only —
 * portfolio-wide numbers, and the list of stores. Everything else lives one
 * level down, inside a store.
 */
export const Portal: React.FC<PortalProps> = ({
  profile, tab, onTabChange, showUsers, onShowUsers, panel, onShowAudit, onShowNetwork, onShowDocTypes,
  onShowSettings, onOpenStore,
}) => {
  const { stores } = useAppStore();
  const [showAbout, setShowAbout] = useState(false);

  const avatarLetter = (profile.displayName || profile.email).slice(0, 1).toUpperCase();
  const today = new Date().toLocaleDateString('ar-LY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const handleLogout = () => supabase.auth.signOut();

  const iconButton =
    'inline-flex items-center justify-center w-11 h-11 rounded-xl text-surface-600 hover:bg-surface-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

  return (
    <div className="min-h-dvh bg-surface-50" dir="rtl">
      <div className="max-w-[1480px] mx-auto p-4 md:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="glass-panel rounded-2xl px-4 md:px-5 py-4 flex flex-wrap items-center justify-between gap-3 sticky top-[max(0.75rem,env(safe-area-inset-top))] z-30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl grid place-items-center text-white font-black text-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm shrink-0">
              ر
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-primary-800 leading-tight">السستم</h1>
              <p className="text-xs text-surface-500 truncate">كل تجارتك... في مكان واحد</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setShowAbout(true)}
              className={iconButton}
              aria-label="عن السستم"
              title="عن السستم"
            >
              <Info size={20} />
            </button>
            {/* Everyone's, unlike the buttons around it: these are the user's
                own preferences, not administration. */}
            <button
              type="button"
              onClick={onShowSettings}
              className={iconButton}
              aria-label="تفضيلاتي"
              title="تفضيلاتي"
            >
              <SlidersHorizontal size={20} />
            </button>
            {profile.role === 'admin' && (
              <button
                type="button"
                onClick={onShowAudit}
                className={iconButton}
                aria-label="سجل النظام"
                title="سجل النظام — التغييرات التي لا تخص متجراً بعينه"
              >
                <ShieldCheck size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={onShowNetwork}
              className={iconButton}
              aria-label="شبكة المتاجر"
              title="شبكة المتاجر وربط المتاجر المملوكة"
            >
              <Link2 size={20} />
            </button>
            {profile.role === 'admin' && (
              <button type="button" onClick={onShowDocTypes} className={iconButton} aria-label="منشئ DocType" title="منشئ DocType">
                <Blocks size={20} />
              </button>
            )}
            {profile.role === 'admin' && (
              <button
                type="button"
                onClick={() => onShowUsers(true)}
                className={iconButton}
                aria-label="إدارة المستخدمين"
                title="إدارة المستخدمين"
              >
                <Settings size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className={`${iconButton} hover:text-rose-700`}
              aria-label="تسجيل الخروج"
              title="تسجيل الخروج"
            >
              <LogOut size={20} />
            </button>
            <div
              className="w-10 h-10 rounded-full bg-primary-100 text-primary-800 grid place-items-center font-black shrink-0"
              title={profile.displayName}
            >
              {avatarLetter}
            </div>
          </div>
        </header>

        {panel ? (
          <section className="mt-8">
            <button
              type="button"
              onClick={() => onTabChange('stats')}
              className="inline-flex items-center gap-2 text-sm font-bold text-surface-600 hover:text-primary-800 mb-6 rounded-lg px-2 py-1 -mr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ArrowRight size={18} />
              رجوع إلى البوابة
            </button>
            {panel}
          </section>
        ) : showUsers ? (
          <section className="mt-8">
            <button
              type="button"
              onClick={() => onShowUsers(false)}
              className="inline-flex items-center gap-2 text-sm font-bold text-surface-600 hover:text-primary-800 mb-6 rounded-lg px-2 py-1 -mr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ArrowRight size={18} />
              رجوع إلى البوابة
            </button>
            <AdminUsers currentUserId={profile.id} />
          </section>
        ) : (
          <>
            <section className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mt-8 mb-6 px-1">
              <div>
                <h2 className="text-3xl md:text-4xl font-black text-surface-900">
                  مرحباً، {profile.displayName}
                </h2>
                <p className="text-surface-500 mt-2">
                  {stores.length > 0
                    ? `تدير ${stores.length} ${stores.length === 1 ? 'متجراً' : 'متاجر'}. اختر متجراً للدخول إلى تفاصيله.`
                    : 'أنشئ متجرك الأول للبدء.'}
                </p>
              </div>
              <span className="bg-white border border-surface-200 text-surface-600 text-sm font-medium rounded-full px-4 py-2 self-start sm:self-auto">
                {today}
              </span>
            </section>

            <div
              role="tablist"
              aria-label="أقسام البوابة"
              className="bg-surface-200/60 rounded-2xl p-1.5 grid grid-cols-2 gap-1.5 max-w-xl mx-auto mb-8"
            >
              {TABS.map(item => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    role="tab"
                    id={`portal-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls={`portal-panel-${item.id}`}
                    onClick={() => onTabChange(item.id)}
                    className={`relative inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                      selected ? 'text-primary-800' : 'text-surface-600 hover:text-surface-900'
                    }`}
                  >
                    {selected && (
                      <motion.span
                        layoutId="portalTabIndicator"
                        className="absolute inset-0 bg-white rounded-xl shadow-sm"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <item.icon size={18} className="relative" />
                    <span className="relative">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <motion.section
              key={tab}
              id={`portal-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`portal-tab-${tab}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {tab === 'stats' ? <Dashboard /> : <Stores onOpenStore={onOpenStore} />}
            </motion.section>
          </>
        )}
      </div>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
};
