import React, { useEffect, useState } from 'react';
import {
  Package,
  Users,
  ShoppingCart,
  Truck,
  MapPin,
  Wallet,
  PieChart,
  Menu,
  X,
  ChevronRight,
  ArrowRight,
  Info,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../db/supabase';
import type { Profile } from '../types';
import { AboutModal } from '../components/AboutModal';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  profile: Profile;
  /** Name of the store being managed — this shell is always scoped to one. */
  storeName: string;
  onExitStore: () => void;
}

const menuItems = [
  { id: 'products', label: 'المنتجات', icon: Package },
  { id: 'orders', label: 'الطلبات', icon: ShoppingCart },
  { id: 'customers', label: 'العملاء', icon: Users },
  { id: 'agents', label: 'المندوبين', icon: Truck },
  { id: 'zones', label: 'مناطق التوصيل', icon: MapPin },
  { id: 'finances', label: 'المالية', icon: Wallet },
  { id: 'reports', label: 'التقارير', icon: PieChart },
];

export const MainLayout: React.FC<MainLayoutProps> = ({
  children, activeTab, setActiveTab, profile, storeName, onExitStore,
}) => {
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

  const avatarLetter = (profile.displayName || profile.email).slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col md:flex-row rtl" dir="rtl">
      {/* Mobile Header */}
      <div className="md:hidden glass-header sticky top-0 z-40 flex items-center justify-between p-4">
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
              className="fixed top-0 right-0 h-full w-72 bg-white/80 backdrop-blur-2xl border-l border-white/50 shadow-2xl z-50 p-6 flex flex-col md:hidden"
            >
              <div className="flex items-start justify-between mb-6 gap-2">
                <div className="min-w-0">
                  <span className="block font-black text-xl text-surface-900 truncate">{storeName}</span>
                  <span className="block text-xs text-surface-500 mt-0.5">إدارة المتجر</span>
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
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                      activeTab === item.id 
                        ? 'bg-primary-50 text-primary-700 shadow-sm border border-primary-100' 
                        : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900'
                    }`}
                  >
                    <item.icon size={20} className={activeTab === item.id ? 'text-primary-500' : 'text-surface-400'} />
                    <span className="font-semibold">{item.label}</span>
                  </button>
                ))}
              </div>
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
                <span className="font-semibold">عن رَوَاج</span>
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 glass-panel border-r-0 border-l border-white/50 z-40">
        <div className="p-5 pb-3">
          <button
            onClick={onExitStore}
            className="flex items-center gap-2 text-sm font-bold text-surface-600 hover:text-primary-800 mb-4 rounded-lg px-2 py-1.5 -ms-2 hover:bg-surface-100 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ArrowRight size={18} />
            كل المتاجر
          </button>
          <h1 className="font-black text-2xl text-surface-900 tracking-tight leading-tight">{storeName}</h1>
          <p className="text-xs text-surface-500 mt-1 font-medium">إدارة المتجر</p>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-1 mt-4">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-colors duration-300 relative group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                activeTab === item.id 
                  ? 'bg-primary-50 text-primary-700 shadow-sm border border-primary-100/50' 
                  : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900'
              }`}
            >
              {activeTab === item.id && (
                <motion.div layoutId="activeTabIndicator" className="absolute right-0 top-1/4 bottom-1/4 w-1 bg-primary-500 rounded-l-full" />
              )}
              <div className="flex items-center gap-3">
                <item.icon size={20} className={activeTab === item.id ? 'text-primary-500' : 'text-surface-400 group-hover:text-surface-600 transition-colors'} />
                <span className="font-semibold">{item.label}</span>
              </div>
              {activeTab === item.id && <ChevronRight size={16} className="text-primary-400" />}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-surface-200/50 mt-auto">
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Info size={17} />
            عن رَوَاج
          </button>
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold shadow-md">
                {avatarLetter}
              </div>
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
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
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
