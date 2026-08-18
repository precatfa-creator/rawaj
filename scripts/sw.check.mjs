// Run with: node scripts/sw.check.mjs
//
// The service worker decides, per request, between "never touch this",
// "network first" and "cache first" — three branches that are invisible until
// something serves a stale build or a cached Supabase row. This runs the real
// file against a fake worker scope and checks which branch each request takes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

const listeners = {};
const putCalls = [];
const cache = {
  put: (request, response) => { putCalls.push([request.url, response]); return Promise.resolve(); },
  delete: () => Promise.resolve(true),
};
const caches = {
  keys: () => Promise.resolve([]),
  delete: () => Promise.resolve(true),
  open: () => Promise.resolve(cache),
  // `matched` is set per case below: null means "nothing cached".
  match: request => Promise.resolve(caches.matched(request)),
  matched: () => null,
};

let networkCalls = [];
const fetched = url => ({ ok: true, type: 'basic', from: 'network', url, clone: () => ({ from: 'network', url }) });
const fetchImpl = request => {
  networkCalls.push(request.url);
  return Promise.resolve(fetched(request.url));
};

const self = {
  location: { origin: 'https://app.example' },
  addEventListener: (type, handler) => { listeners[type] = handler; },
  skipWaiting: () => {},
  clients: { claim: () => Promise.resolve() },
};

new Function('self', 'caches', 'fetch', 'URL', source)(self, caches, fetchImpl, URL);

/** Runs the fetch handler and reports what it did with the request. */
const dispatch = async (request) => {
  let responded;
  listeners.fetch({ request, respondWith: promise => { responded = promise; } });
  return responded === undefined ? 'passed through' : await responded;
};

const request = (url, extra = {}) => ({ url, method: 'GET', mode: 'no-cors', ...extra });

// Anything not a same-origin GET is left to the browser. A cached Supabase
// response would mean stale rows and, worse, a stale auth token.
assert.equal(await dispatch(request('https://xyz.supabase.co/rest/v1/orders')), 'passed through');
assert.equal(await dispatch(request('https://app.example/api', { method: 'POST' })), 'passed through');
assert.equal(await dispatch(request('https://fonts.googleapis.com/css2?family=Tajawal')), 'passed through');

// The document goes to the network first: hash routing makes every navigation
// "/", so serving it from cache would pin the user to an old build.
networkCalls = [];
caches.matched = () => ({ from: 'cache' });
let response = await dispatch(request('https://app.example/', { mode: 'navigate' }));
assert.equal(response.from, 'network');
assert.deepEqual(networkCalls, ['https://app.example/']);

// ...and falls back to the cached copy only when the network is gone.
const offline = { ...caches };
caches.match = req => Promise.resolve({ from: 'cache', url: req.url });
const failing = new Function('self', 'caches', 'fetch', 'URL', source);
const offlineListeners = {};
failing({ ...self, addEventListener: (type, handler) => { offlineListeners[type] = handler; } },
  offline, () => Promise.reject(new Error('offline')), URL);
let offlineResponse;
offlineListeners.fetch({
  request: request('https://app.example/', { mode: 'navigate' }),
  respondWith: promise => { offlineResponse = promise; },
});
assert.equal((await offlineResponse).from, 'cache');

// A hashed asset never changes under its URL, so a hit is served without a
// network round trip — this is what makes the second load instant.
caches.match = req => Promise.resolve(caches.matched(req));
networkCalls = [];
caches.matched = () => ({ from: 'cache' });
response = await dispatch(request('https://app.example/assets/index-abc123.js'));
assert.equal(response.from, 'cache');
assert.deepEqual(networkCalls, []);

// A miss fetches and stores it.
caches.matched = () => null;
putCalls.length = 0;
response = await dispatch(request('https://app.example/assets/index-def456.css'));
assert.equal(response.from, 'network');
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(putCalls.map(([url]) => url), ['https://app.example/assets/index-def456.css']);

console.log('sw.check: ok');
