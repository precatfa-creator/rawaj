import React, { useEffect, useState } from 'react';
import {
  Package,
  Users,
  ShoppingCart,
  Truck,
  MapPin,
  Wallet,
  History,
  PieChart,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Info,
  Hash,
  ShieldCheck,
  KeyRound,
  LogOut
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../db/supabase';
import type { Profile } from '../types';
import { AboutModal } from '../components/AboutModal';
import { CopyableCode, Avatar } from '../components/ui';
import { loadCollapsedGroups, saveCollapsedGroups } from '../lib/settings';
import { useAppStore } from '../store';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  profile: Profile;
  /** Name of the store being managed — this shell is always scoped to one. */
  storeName: string;
  /** Its public code, shown under the name so it can be read out or copied. */
  storeCode: string;
  /** Optional cover image, shown under the heading so the store is recognisable. */
  storeImage: string;
  onExitStore: () => void;
}

/**
 * The sidebar in groups rather than one run of eleven links.
 *
 * Grouped by the question being asked, not by the table behind it: what do we
 * have (المخزون), who is buying (المبيعات), how does it get there (التوصيل),
 * how did we do (التقارير). Eleven flat items all read as equally likely, so
 * the eye has to check every one; four short lists are scanned by heading.
 *
 * Order follows the working day — stock, then orders, then delivery, then the
 * numbers — with the settings nobody opens daily last.
 */
const navGroups: Array<{
  title: string;
  adminOnly?: boolean;
  items: Array<{ id: string; label: string; icon: LucideIcon }>;
}> = [
  {
    title: 'المخزون',
    items: [
      { id: 'products', label: 'المنتجات', icon: Package },
      { id: 'movements', label: 'حركات المخزون', icon: History },
    ],
  },
  {
    title: 'المبيعات',
    items: [
      { id: 'orders', label: 'الطلبات', icon: ShoppingCart },
      { id: 'customers', label: 'العملاء', icon: Users },
    ],
  },
  {
    title: 'التوصيل',
    items: [
      { id: 'agents', label: 'المندوبين', icon: Truck },
      { id: 'zones', label: 'مناطق التوصيل', icon: MapPin },
    ],
  },
  {
    title: 'التقارير',
    items: [
      { id: 'finances', label: 'المالية', icon: Wallet },
      { id: 'reports', label: 'التقارير', icon: PieChart },
    ],
  },
  {
    // Permissions joins naming and the audit log here: all three change how the
    // store works rather than what it sells, and all three are administrators'.
    // It used to sit in the everyone list, which offered every user a screen
    // whose writes the database was going to refuse anyway.
    title: 'إدارة المتجر',
    adminOnly: true,
    items: [
      { id: 'permissions', label: 'صلاحيات المتجر', icon: KeyRound },
      { id: 'naming', label: 'تسمية المستندات', icon: Hash },
      { id: 'audit', label: 'سجل التدقيق', icon: ShieldCheck },
    ],
  },
];

/**
 * A group label, and its toggle when groups are collapsible.
 *
 * The heading itself is the button so the whole label is the target — a chevron
 * alone is a 16px hit area for something used constantly. When groups are always
 * shown it renders as a plain heading, with no dead control to explain.
 */
const GroupHeading: React.FC<{
  group: { title: string; items: Array<{ id: string }> };
  collapsible: boolean;
  open: boolean;
  onToggle: () => void;
  idPrefix?: string;
}> = ({ group, collapsible, open, onToggle, idPrefix = 'nav-mobile' }) => {
  const className = 'px-4 mb-1.5 text-[0.68rem] font-black tracking-[0.14em] text-surface-400';
  if (!collapsible) return <h2 className={className}>{group.title}</h2>;

  return (
    <h2 className="mb-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${idPrefix}-${group.title}`}
        className={`w-full flex items-center justify-between gap-2 rounded-lg py-1 ${className} mb-0
          hover:text-surface-600 hover:bg-surface-50 transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
      >
        <span>{group.title}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
    </h2>
  );
};

export const MainLayout: React.FC<MainLayoutProps> = ({
  children, activeTab, setActiveTab, profile, storeName, storeCode, storeImage, onExitStore,
}) => {
  const { settings } = useAppStore();
  const groups = navGroups.filter(group => !group.adminOnly || profile.role === 'admin');

  // `always` hides the toggles rather than disabling them: a control that
  // cannot do anything is worse than no control.
  const collapsible = settings.sidebarGroups === 'collapsible';
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsedGroups);

  const toggleGroup = (title: string) => setCollapsed(current => {
    const next = current.includes(title) ? current.filter(t => t !== title) : [...current, title];
    saveCollapsedGroups(next);
    return next;
  });

  /**
   * A collapsed group hiding the page you are on reads as a broken nav, so the
   * group holding the active item stays open whatever the stored state says.
   */
  const isOpen = (group: (typeof navGroups)[number]) =>
    !collapsible || !collapsed.includes(group.title) || group.items.some(item => item.id === activeTab);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // The drawer is the only way to navigate on mobile, so it has to behave like a
  // dialog: Escape closes it and the page behind it stops scrolling.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-dvh bg-surface-50 flex flex-col md:flex-row rtl" dir="rtl">
      {/* Mobile Header */}
      <div className="md:hidden glass-header sticky top-0 z-40 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="فتح القائمة"
            aria-expanded={isMobileMenuOpen}
            className="inline-flex items-center justify-center w-11 h-11 -ms-2 rounded-xl text-surface-600 hover:text-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Menu size={24} />
          </button>
          {/* The sidebar h1 is desktop-only, so this is the mobile view's h1. */}
          <h1 className="font-bold text-lg text-surface-900 truncate">{storeName}</h1>
        </div>
        <button
          onClick={onExitStore}
          aria-label="رجوع إلى البوابة"
          className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-surface-600 hover:text-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ArrowRight size={22} />
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-surface-900/20 backdrop-blur-sm z-50 md:hidden"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="قائمة المتجر"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-72 bg-white/80 backdrop-blur-2xl border-l border-white/50 shadow-2xl z-50 p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col md:hidden"
            >
              <div className="flex items-start justify-between mb-6 gap-2">
                <div className="min-w-0">
                  <span className="block font-black text-xl text-surface-900 truncate">{storeName}</span>
                  <CopyableCode value={storeCode} className="mt-0.5" />
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label="إغلاق القائمة"
                  className="inline-flex items-center justify-center w-11 h-11 shrink-0 text-surface-500 hover:text-surface-900 bg-surface-100 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <X size={20} />
                </button>
              </div>
              <button
                onClick={() => { onExitStore(); setIsMobileMenuOpen(false); }}
                className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl text-surface-700 bg-surface-100 hover:bg-surface-200 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <ArrowRight size={20} />
                <span className="font-semibold">كل المتاجر</span>
              </button>
              {/* `nav` + a labelled list per group, so a screen reader hears
                  "المبيعات, list, 2 items" instead of eleven loose buttons. */}
              <nav aria-label="أقسام المتجر" className="flex-1 overflow-y-auto no-scrollbar space-y-5">
                {groups.map(group => (
                  <div key={group.title}>
                    <GroupHeading
                      group={group}
                      collapsible={collapsible}
                      open={isOpen(group)}
                      onToggle={() => toggleGroup(group.title)}
                    />
                    <ul id={`nav-mobile-${group.title}`} hidden={!isOpen(group)} className="space-y-1">
                      {group.items.map(item => (
                        <li key={item.id}>
                          <button
                            onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                            aria-current={activeTab === item.id ? 'page' : undefined}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                              activeTab === item.id
                                ? 'bg-primary-50 text-primary-700 shadow-sm border border-primary-100'
                                : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900'
                            }`}
                          >
                            <item.icon size={20} className={activeTab === item.id ? 'text-primary-500' : 'text-surface-400'} />
                            <span className="font-semibold">{item.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <button onClick={handleLogout} className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors w-full">
                <LogOut size={20} />
                <span className="font-semibold">تسجيل الخروج</span>
              </button>
              <button
                type="button"
                onClick={() => { setIsMobileMenuOpen(false); setShowAbout(true); }}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-surface-600 transition-colors hover:bg-surface-50 hover:text-primary-700"
              >
                <Info size={20} />
                <span className="font-semibold">عن السستم</span>
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 glass-panel border-r-0 border-l border-white/50 z-40">
        {/* The store photo is the header, not a thumbnail inside it: the name,
            the code and the back link all sit on top of it.

            Two things keep that readable over an image nobody vetted. The
            gradient is opaque at the bottom where the text sits and clears
            towards the top, so a pale photo cannot wash the name out. The mask
            below only starts fading past the last line of text, and runs out
            inside the navigation, so the photograph dissolves into the sidebar
            instead of ending as a box. */}
        <div className={`relative ${storeImage ? 'text-white' : ''}`}>
          {storeImage && (
            /* ponytail: one mask on the wrapper does the whole dissolve. The
               photo and its darkening gradient both sit inside the mask, so
               they fade out together and the sidebar's own background is what
               emerges — no white haze band painted over the seam. Stops are in
               px from the bottom, not percentages, so the opaque part always
               covers the text no matter how tall the header grows. */
            <div className="absolute inset-x-0 top-0 -bottom-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_0,black_calc(100%_-_124px),rgba(0,0,0,0.5)_calc(100%_-_74px),rgba(0,0,0,0.14)_calc(100%_-_30px),transparent_100%)]">
              <img
                src={storeImage}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(15,23,42,0)_0%,rgba(15,23,42,0.35)_28%,rgba(15,23,42,0.8)_52%,rgba(15,23,42,0.62)_78%,rgba(15,23,42,0.3)_100%)]" />
            </div>
          )}

          <div className="relative z-10 p-5 pb-8">
            <button
              onClick={onExitStore}
              className={`flex items-center gap-2 text-sm font-bold mb-4 rounded-lg px-2 py-1.5 -ms-2 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 ${
                storeImage
                  ? 'text-white/90 hover:text-white hover:bg-white/15 focus-visible:ring-white/70'
                  : 'text-surface-600 hover:text-primary-800 hover:bg-surface-100 focus-visible:ring-primary-500'
              }`}
            >
              <ArrowRight size={18} />
              كل المتاجر
            </button>
            <h1 className={`font-black text-2xl tracking-tight leading-tight ${
              storeImage ? 'text-white drop-shadow-sm' : 'text-surface-900'
            }`}>
              {storeName}
            </h1>
            <CopyableCode value={storeCode} tone={storeImage ? 'dark' : 'light'} className="mt-1" />
            <p className={`text-xs mt-1 font-medium ${storeImage ? 'text-white/75' : 'text-surface-500'}`}>
              إدارة المتجر
            </p>
          </div>
        </div>

        {/* No top margin here: the navigation begins inside the feather's final
            transparent pixels, which is what removes the old horizontal seam. */}
        <nav aria-label="أقسام المتجر" className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
          {groups.map(group => (
            <div key={group.title}>
              <GroupHeading
                group={group}
                collapsible={collapsible}
                open={isOpen(group)}
                onToggle={() => toggleGroup(group.title)}
                idPrefix="nav-desktop"
              />
              <ul id={`nav-desktop-${group.title}`} hidden={!isOpen(group)} className="space-y-1">
                {group.items.map(item => (
                  <li key={item.id}>
                    <button
                      onClick={() => setActiveTab(item.id)}
                      aria-current={activeTab === item.id ? 'page' : undefined}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-colors duration-300 relative group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        activeTab === item.id
                          ? 'bg-primary-50 text-primary-700 shadow-sm border border-primary-100/50'
                          : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900'
                      }`}
                    >
                      {/* One shared layoutId across every group, so the marker
                          slides between groups instead of blinking out here and
                          reappearing there. */}
                      {activeTab === item.id && (
                        <motion.div layoutId="activeTabIndicator" className="absolute right-0 top-1/4 bottom-1/4 w-1 bg-primary-500 rounded-l-full" />
                      )}
                      <div className="flex items-center gap-3">
                        <item.icon size={20} className={activeTab === item.id ? 'text-primary-500' : 'text-surface-400 group-hover:text-surface-600 transition-colors'} />
                        <span className="font-semibold">{item.label}</span>
                      </div>
                      {activeTab === item.id && <ChevronRight size={16} className="text-primary-400" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-surface-200/50 mt-auto">
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Info size={17} />
            عن السستم
          </button>
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <Avatar
                src={profile.avatarUrl}
                name={profile.displayName || profile.email}
                className="w-10 h-10 shadow-md"
                fallbackClass="bg-gradient-to-br from-primary-400 to-primary-600 text-white"
              />
              <div className="flex flex-col">
                <span className="font-bold text-sm text-surface-900 max-w-32 truncate">{profile.displayName}</span>
                <span className="text-xs text-surface-500">{profile.role === 'admin' ? 'مدير النظام' : 'مستخدم'}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-surface-400 hover:text-rose-600 rounded-lg transition-colors" title="تسجيل الخروج">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto h-full"
          >
            {children}
          </motion.div>
        </div>
      </main>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
};
