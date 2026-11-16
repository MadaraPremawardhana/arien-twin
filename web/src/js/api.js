// Accounts and data: a small client for the ARIEN Base44 app's REST API (the same endpoints its own SDK calls).
// The access token lives in this site's localStorage and is sent only to CONFIG.apiBase.
import { CONFIG, store, url } from './core.js';

const TOKEN = 'base44_access_token', USER = 'arien:user';
export const token = () => store.get(TOKEN);
export const signedIn = () => !!token();
export function setToken(t) { if (t) { store.set(TOKEN, t); document.documentElement.dataset.auth = 'in'; } }
export function clearSession() { store.del(TOKEN); store.del('token'); store.del(USER); document.documentElement.dataset.auth = 'out'; }
export const cachedUser = () => store.json(USER);

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.name = 'ApiError'; this.status = status; this.data = data; }
}

async function call(method, path, { body, params } = {}) {
  const u = new URL(CONFIG.apiBase + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  const headers = { Accept: 'application/json', 'X-App-Id': CONFIG.appId };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = token(); if (t) headers.Authorization = 'Bearer ' + t;
  let res;
  try { res = await fetch(u, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new ApiError('Could not reach the ARIEN account service. Check your connection and try again.', 0); }
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || (typeof data.detail === 'string' && data.detail))) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

const app = () => `/apps/${CONFIG.appId}`;

function entity(name) {
  const base = () => `${app()}/entities/${name}`;
  return {
    /** Records matching `q` (all the caller may see when omitted). Returns an array. */
    async filter(q, { sort, limit, fields } = {}) {
      const r = await call('GET', base(), { params: { q: q && Object.keys(q).length ? q : undefined, sort, limit, fields: Array.isArray(fields) ? fields.join(',') : fields } });
      return Array.isArray(r) ? r : (r && r.items) || [];
    },
    get: (id) => call('GET', `${base()}/${encodeURIComponent(id)}`),
    create: (data) => call('POST', base(), { body: data }),
    update: (id, data) => call('PUT', `${base()}/${encodeURIComponent(id)}`, { body: data }),
    remove: (id) => call('DELETE', `${base()}/${encodeURIComponent(id)}`),
    async count(q) { const r = await call('GET', `${base()}/count`, { params: { q } }); return r && typeof r.count === 'number' ? r.count : 0; }
  };
}

export const SolarSite = entity('SolarSite');
export const SalesLead = entity('SalesLead');
export const Waitlist = entity('Waitlist');
export const AcademicApplication = entity('AcademicApplication');

let mePromise = null;
export const auth = {
  /** The signed-in user. A rejected token signs this browser out. */
  me({ fresh = false } = {}) {
    if (!signedIn()) return Promise.reject(new ApiError('Not signed in', 401));
    if (!mePromise || fresh) {
      mePromise = call('GET', `${app()}/entities/User/me`).then(u => { store.set(USER, JSON.stringify(slim(u))); return u; })
        .catch(e => { mePromise = null; if (e.status === 401 || e.status === 403) clearSession(); throw e; });
    }
    return mePromise;
  },
  async updateMe(data) { const u = await call('PUT', `${app()}/entities/User/me`, { body: data }); mePromise = null; return u; },
  async login(email, password) {
    const r = await call('POST', `${app()}/auth/login`, { body: { email, password } });
    if (r && r.access_token) setToken(r.access_token);
    mePromise = null; return r;
  },
  register: (email, password) => call('POST', `${app()}/auth/register`, { body: { email, password } }),
  async verifyOtp(email, otpCode) {
    const r = await call('POST', `${app()}/auth/verify-otp`, { body: { email, otp_code: otpCode } });
    if (r && r.access_token) setToken(r.access_token);
    mePromise = null; return r;
  },
  resendOtp: (email) => call('POST', `${app()}/auth/resend-otp`, { body: { email } }),
  resetPasswordRequest: (email) => call('POST', `${app()}/auth/reset-password-request`, { body: { email } }),
  resetPassword: (resetToken, newPassword) => call('POST', `${app()}/auth/reset-password`, { body: { reset_token: resetToken, new_password: newPassword } }),
  /** Google sign-in runs on the account service and comes back to `returnPath` with the token in the address, which the page's first script stores and removes. */
  googleUrl(returnPath = '') {
    return `${CONFIG.authBase}/api/apps/auth/login?app_id=${encodeURIComponent(CONFIG.appId)}&from_url=${encodeURIComponent(url(returnPath))}`;
  },
  signOut() { clearSession(); mePromise = null; }
};

// What the nav needs straight away on the next page load (no token, nothing sensitive beyond name, email and plan).
function slim(u) { return u ? { id: u.id, full_name: u.full_name, email: u.email, plan: u.plan, last_site_id: u.last_site_id, settings: u.settings || {} } : null; }

export const displayName = (u) => (u && ((u.settings && u.settings.display_name) || u.full_name || u.email)) || 'Account';
export const initials = (u) => displayName(u).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Plan key and its saved-site limit, as the Base44 app defines them. */
export function planKey(p) {
  const e = String(p || 'household').toLowerCase();
  return e.includes('academic') ? 'academic' : e.includes('pro') || e.includes('installer') ? 'pro' : e.includes('industry') || e.includes('enterprise') ? 'industry' : 'household';
}
export const PLAN_NAMES = { household: 'Household', academic: 'Academic', pro: 'Pro / Installer', industry: 'Industry' };
export const siteLimit = (p) => (planKey(p) === 'household' ? 1 : Infinity);
