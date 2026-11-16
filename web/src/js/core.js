// Shared helpers: settings, site-relative URLs, storage that never throws, toasts.
export const CONFIG = Object.assign({
  appId: '', apiBase: '', authBase: '', twinUrl: ''
}, window.ARIEN_CONFIG || {});

/** The site's root URL, whatever folder it is served from (pages carry data-root="./" or "../"). */
export const ROOT = new URL(document.documentElement.dataset.root || './', location.href);
export const url = (path = '') => new URL(path, ROOT).href;
export const go = (path) => { location.href = url(path); };

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: carry on without it */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  json(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
};

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(title, text = '', kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 't ' + kind;
  const b = document.createElement('b'); b.textContent = title; t.appendChild(b);
  if (text) t.appendChild(document.createTextNode(text));
  box.appendChild(t); setTimeout(() => t.remove(), 6000);
}

/** A path inside this site that is safe to return to after signing in (never another origin, never a token). */
export function safeReturn(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw, ROOT);
    if (u.origin !== location.origin || !u.pathname.startsWith(ROOT.pathname)) return null;
    for (const k of ['access_token', 'clear_access_token', 'app_id', 'app_base_url', 'functions_version', 'from_url']) u.searchParams.delete(k);
    return u.pathname.slice(ROOT.pathname.length) + u.search + u.hash;
  } catch (e) { return null; }
}
