import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AppProvider, useAppStore } from './store';
import { MainLayout } from './layouts/MainLayout';
import { Portal, type PortalTab } from './pages/Portal';
import { Products } from './pages/Products';
import { StockMovements } from './pages/StockMovements';
import { Orders } from './pages/Orders';
import { Customers } from './pages/Customers';
import { Zones } from './pages/Zones';
import { SalesReps } from './pages/SalesReps';
import { Finances } from './pages/Finances';
import { Reports } from './pages/Reports';
import { AuditLog } from './pages/AuditLog';
import { DocumentNamingSettings } from './pages/DocumentNaming';
import { RolePermissionManager } from './pages/RolePermissionManager';
import { StoreNetwork } from './pages/StoreNetwork';
import { DocTypeBuilder } from './pages/DocTypeBuilder';
import { Preferences } from './pages/Preferences';
import { Login } from './pages/Login';
import { isSupabaseConfigured, supabase } from './db/supabase';
import { DEFAULT_STORE_SECTION, useRoute } from './lib/route';
import type { Profile } from './types';
/**
 * Admin-only, and it drags in the Markdown renderer plus the Puter SDK loader.
 * Lazy so the ~165 kB never reaches the users who cannot open it, and Suspense
 * renders nothing while it arrives — the launcher is a floating button, so
 * there is no layout to hold open.
 */
const AdminDatabaseChat = lazy(() =>
  import('./components/AdminDatabaseChat').then(m => ({ default: m.AdminDatabaseChat })));

/**
 * Two levels, both addressable: `#/` and `#/stores` are the portal, and
 * `#/store/<id>/<section>` is the store workspace. The URL is the source of
 * truth, so back/forward and refresh all land where the user expects.
 */
const Workspace: React.FC<{ profile: Profile }> = ({ profile }) => {
  const { stores, setActiveStore } = useAppStore();
  const [route, navigate] = useRoute();

  const store = stores.find(s => s.id === route.storeId);

  // Context still holds the active store because Products/Orders scope off it.
  useEffect(() => {
    setActiveStore(store ? store.id : null);
  }, [store, setActiveStore]);

  // A URL pointing at a store that does not exist drops back to the store list
  // rather than rendering an empty shell.
  useEffect(() => {
    if (route.storeId && stores.length > 0 && !store) {
      navigate({ view: 'stores', storeId: null, page: 0 }, true);
    }
  }, [route.storeId, stores.length, store]);

  if (!store) {
    const portalTab: PortalTab = route.view === 'stores' ? 'stores' : 'stats';
    return (
      <>
        <Portal
          profile={profile}
          tab={portalTab}
          onTabChange={tab => navigate({ view: tab, storeId: null, page: 0 })}
          showUsers={route.view === 'users'}
          panel={profile.role === 'admin' && route.view === 'audit'
            ? <AuditLog storeId={null} page={route.page} onPage={p => navigate({ view: 'audit', storeId: null, page: p })} />
            : route.view === 'network'
              ? <StoreNetwork />
            : profile.role === 'admin' && route.view === 'doctypes'
              ? <DocTypeBuilder />
            // Preferences are the user's own, so every signed-in user gets them.
            : route.view === 'settings'
              ? <Preferences />
            : null}
          onShowAudit={() => navigate({ view: 'audit', storeId: null, page: 0 })}
          onShowNetwork={() => navigate({ view: 'network', storeId: null, page: 0 })}
          onShowDocTypes={() => navigate({ view: 'doctypes', storeId: null, page: 0 })}
          onShowSettings={() => navigate({ view: 'settings', storeId: null, page: 0 })}
          onShowUsers={show => navigate({ view: show ? 'users' : 'stats', storeId: null, page: 0 })}
          onOpenStore={id => navigate({ view: DEFAULT_STORE_SECTION, storeId: id, page: 0 })}
        />
        {profile.role === 'admin' && (
          <Suspense fallback={null}>
            <AdminDatabaseChat stores={stores} activeStoreId={null} />
          </Suspense>
        )}
      </>
    );
  }

  // The list page lives in the URL, so a page is linkable and survives refresh.
  const paging = {
    page: route.page,
    onPage: (page: number) => navigate({ view: route.view, storeId: store?.id ?? null, page }),
  };

  const renderContent = () => {
    switch (route.view) {
      case 'products': return <Products {...paging} />;
      case 'movements': return <StockMovements {...paging} />;
      case 'orders': return <Orders {...paging} />;
      case 'customers': return <Customers {...paging} />;
      case 'zones': return <Zones />;
      case 'finances': return <Finances />;
      case 'reports': return <Reports />;
      case 'agents': return <SalesReps />;
      // Admin-only sections. A non-admin who types the URL gets the products
      // list rather than an empty shell — the nav never offered them the link.
      case 'naming': return profile.role === 'admin'
        ? <DocumentNamingSettings storeId={store.id} /> : <Products {...paging} />;
      case 'audit': return profile.role === 'admin'
        ? <AuditLog storeId={store.id} {...paging} /> : <Products {...paging} />;
      case 'permissions': return profile.role === 'admin'
        ? <RolePermissionManager storeId={store.id} /> : <Products {...paging} />;
      default: return <Products {...paging} />;
    }
  };

  return (
    <>
      <MainLayout
        activeTab={route.view}
        setActiveTab={view => navigate({ view, storeId: store.id, page: 0 })}
        profile={profile}
        storeName={store.name}
        storeCode={store.storeCode}
        storeImage={store.image}
        onExitStore={() => navigate({ view: 'stores', storeId: null, page: 0 })}
      >
        {renderContent()}
      </MainLayout>
      {profile.role === 'admin' && (
        <Suspense fallback={null}>
          <AdminDatabaseChat stores={stores} activeStoreId={store.id} />
        </Suspense>
      )}
    </>
  );
};

const toProfile = (row: Record<string, unknown>): Profile => ({
  id: row.id as string,
  email: row.email as string,
  displayName: (row.display_name as string) || (row.email as string),
  role: row.role as Profile['role'],
  active: row.active as boolean,
  createdAt: row.created_at as string,
});

const AppContent: React.FC = () => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  const applySession = useCallback(async (session: Session | null) => {
    if (!session) {
      setProfile(null);
      setIsInitializing(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,display_name,role,active,created_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error || !data || !data.active) {
      setAuthNotice(
        error
          ? 'تعذر التحقق من صلاحية الحساب. يرجى المحاولة لاحقاً.'
          : 'هذا الحساب غير مفعّل. تواصل مع مدير النظام.',
      );
      setProfile(null);
      await supabase.auth.signOut();
      setIsInitializing(false);
      return;
    }

    setAuthNotice('');
    setProfile(toProfile(data));
    setIsInitializing(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthNotice('لم يتم إعداد اتصال Supabase بعد. أضف متغيرات البيئة المطلوبة.');
      setIsInitializing(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Run profile queries outside the auth callback's lock.
      window.setTimeout(() => void applySession(session), 0);
    });

    return () => listener.subscription.unsubscribe();
  }, [applySession]);

  if (isInitializing) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-surface-50">
        <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <Login authNotice={authNotice} />;
  }

  return (
    <AppProvider>
      <Workspace profile={profile} />
    </AppProvider>
  );
};

export default function App() {
  return <AppContent />;
}
