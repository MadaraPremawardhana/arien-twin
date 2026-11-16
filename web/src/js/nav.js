// Header: account menu, mobile menu, sign out, and the signed-in user's initials.
import { $, $$, go } from './core.js';
import { auth, signedIn, cachedUser, displayName, initials } from './api.js';

function paintUser(u) {
  if (!u) return;
  const av = $('#avatar'); if (av) { av.textContent = initials(u); av.title = u.full_name || u.email || ''; }
  const n = $('#acct-name'); if (n) n.textContent = displayName(u);
  const e = $('#acct-email'); if (e) e.textContent = u.email || '';
}

/**
 * Glide to a section so its title sits just under the sticky header. The browser's own smooth scrolling does the
 * easing (it stays smooth while the globe is drawing); with "reduce motion" set it jumps instead.
 */
function glideTo(section, { focus = true } = {}) {
  const target = section.querySelector('.sec-head') || section, header = $('.st .nav');
  const top = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, target.getBoundingClientRect().top + scrollY - (header ? header.offsetHeight : 0) - 20));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
  if (!focus) return;
  // once it arrives, move keyboard focus to the section so Tab continues from there
  let done = false;
  const finish = () => { if (done) return; done = true; removeEventListener('scrollend', finish); section.setAttribute('tabindex', '-1'); section.focus({ preventScroll: true }); };
  if (still || Math.abs(top - scrollY) < 2) finish(); else { addEventListener('scrollend', finish, { once: true }); setTimeout(finish, 1600); }
}
function startSectionLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="#"]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    const u = new URL(a.href, location.href); if (u.origin !== location.origin || u.pathname !== location.pathname || u.hash.length < 2) return;
    const section = document.getElementById(decodeURIComponent(u.hash.slice(1))); if (!section) return;
    e.preventDefault();
    if (location.hash !== u.hash) history.pushState(null, '', u.hash);
    glideTo(section);
  });
  // arriving from another page with #how, #who or #pricing: settle on the title once the page has laid out
  if (location.hash.length > 1) { const s = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (s) setTimeout(() => glideTo(s, { focus: false }), 250); }
  addEventListener('popstate', () => { const s = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); if (s) glideTo(s, { focus: false }); });
}

export function startNav() {
  startSectionLinks();
  const menu = $('#acct-menu'), avatar = $('#avatar'), mm = $('#mobile-menu'), mb = $('#menu-btn');
  if (avatar && menu) {
    const close = () => { menu.hidden = true; avatar.setAttribute('aria-expanded', 'false'); };
    avatar.addEventListener('click', () => { menu.hidden = !menu.hidden; avatar.setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('mousedown', (e) => { if (!menu.hidden && !$('#account').contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', (e) => { if (e.target.closest('a,button')) close(); });
  }
  if (mb && mm) {
    const set = (open) => { mm.hidden = !open; mb.setAttribute('aria-expanded', String(open)); mb.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
    mb.addEventListener('click', () => set(mm.hidden));
    mm.addEventListener('click', (e) => { if (e.target.closest('a,button')) set(false); });
  }
  $$('[data-signout]').forEach(b => b.addEventListener('click', () => { auth.signOut(); go(''); }));
  if (signedIn()) {
    paintUser(cachedUser());
    auth.me().then(paintUser).catch(() => { /* the token was refused: the page now shows the signed-out header */ });
  }
}
