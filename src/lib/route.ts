import { useEffect, useState } from 'react';

export interface Route {
  /** Portal tab, or the section inside a store. */
  view: string;
  /** Set when a store is open. */
  storeId: string | null;
  /** Set when a single record is open inside the section, e.g. an order. */
  recordId?: string | null;
  /**
   * Everything else the page is showing — filters, sort, page size — as query
   * parameters, so a narrowed list is a link somebody can send.
   */
  params?: Record<string, string>;
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
 *   #/store/<id>/orders/<orderId>  that order's details, open
   *   #/store/<id>/naming   that store's naming series (admins only)
   *   #/store/<id>/audit    that store's changes (admins only)
   *   #/store/<id>/permissions  store-scoped role permissions
 */
export const parseHash = (hash: string): Route => {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);

  const search = new URLSearchParams(query);

  // `p` is 1-based in the URL and 0-based in state, so shared links read naturally.
  const raw = Number(search.get('p'));
  const page = Number.isInteger(raw) && raw > 1 ? raw - 1 : 0;

  // `p` is the router's own; everything else belongs to whichever page reads it.
  const params: Record<string, string> = {};
  search.forEach((value, key) => { if (key !== 'p' && value !== '') params[key] = value; });

  if (parts[0] === 'store' && parts[1]) {
    const section = parts[2] && STORE_SECTIONS.includes(parts[2]) ? parts[2] : DEFAULT_STORE_SECTION;
    const recordId = parts[3] ? decodeURIComponent(parts[3]) : null;
    return { view: section, storeId: decodeURIComponent(parts[1]), recordId, params, page };
  }

  const view = parts[0] && PORTAL_VIEWS.includes(parts[0]) ? parts[0] : 'stats';
  return { view, storeId: null, params, page };
};

export const buildHash = (route: Route): string => {
  const record = route.storeId && route.recordId ? `/${encodeURIComponent(route.recordId)}` : '';
  const path = route.storeId
    ? `#/store/${encodeURIComponent(route.storeId)}/${route.view}${record}`
    : route.view === 'stats' ? '#/' : `#/${route.view}`;
  // Sorted so the same view always produces the same string — otherwise
  // `navigate` cannot tell "already here" from "changed".
  const search = new URLSearchParams();
  Object.keys(route.params ?? {}).sort().forEach(key => {
    const value = (route.params ?? {})[key];
    if (value !== '') search.set(key, value);
  });
  if (route.page > 0) search.set('p', String(route.page + 1));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
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
