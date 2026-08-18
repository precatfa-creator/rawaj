import { useEffect, useState } from 'react';

export interface Route {
  /** Portal tab, or the section inside a store. */
  view: string;
  /** Set when a store is open. */
  storeId: string | null;
  /** Zero-based list page, carried in the hash so a page is linkable. */
  page: number;
}

const STORE_SECTIONS = [
  'products', 'movements', 'orders', 'customers', 'agents', 'zones', 'finances', 'reports',
  'naming', 'audit', 'permissions',
];
const PORTAL_VIEWS = ['stats', 'stores', 'users', 'audit', 'network', 'doctypes', 'settings'];

export const DEFAULT_STORE_SECTION = 'products';

/**
 * Routes live in the hash so the app keeps working from `file://` and from any
 * static host without a rewrite rule:
 *   #/            portal, stats tab
 *   #/stores      portal, stores tab
 *   #/users       portal, admin users
 *   #/audit       portal, the changes no store owns (admins only)
 *   #/network     portal, linked stores and ownership requests
 *   #/doctypes    portal, global DocType Builder (system admins only)
 *   #/settings    portal, this user's own preferences
 *   #/store/<id>/orders
   *   #/store/<id>/naming   that store's naming series (admins only)
   *   #/store/<id>/audit    that store's changes (admins only)
   *   #/store/<id>/permissions  store-scoped role permissions
 */
export const parseHash = (hash: string): Route => {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);

  // `p` is 1-based in the URL and 0-based in state, so shared links read naturally.
  const raw = Number(new URLSearchParams(query).get('p'));
  const page = Number.isInteger(raw) && raw > 1 ? raw - 1 : 0;

  if (parts[0] === 'store' && parts[1]) {
    const section = parts[2] && STORE_SECTIONS.includes(parts[2]) ? parts[2] : DEFAULT_STORE_SECTION;
    return { view: section, storeId: decodeURIComponent(parts[1]), page };
  }

  const view = parts[0] && PORTAL_VIEWS.includes(parts[0]) ? parts[0] : 'stats';
  return { view, storeId: null, page };
};

export const buildHash = (route: Route): string => {
  const path = route.storeId
    ? `#/store/${encodeURIComponent(route.storeId)}/${route.view}`
    : route.view === 'stats' ? '#/' : `#/${route.view}`;
  return route.page > 0 ? `${path}?p=${route.page + 1}` : path;
};

/** Props every paged list page receives from the router. */
export interface PagedProps {
  page: number;
  onPage: (page: number) => void;
}

/** Reads the hash, and keeps it in sync with back/forward navigation. */
export const useRoute = (): [Route, (next: Route, replace?: boolean) => void] => {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: Route, replace = false) => {
    const hash = buildHash(next);
    if (hash === (window.location.hash || '#/')) {
      setRoute(next);
      return;
    }
    if (replace) window.history.replaceState(null, '', hash);
    else window.location.hash = hash;
    setRoute(next);
  };

  return [route, navigate];
};
