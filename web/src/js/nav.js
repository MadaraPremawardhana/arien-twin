// Header: account menu, mobile menu, sign out, and the signed-in user's initials.
import { $, $$, go } from './core.js';
import { auth, signedIn, cachedUser, displayName, initials } from './api.js';

function paintUser(u) {
  if (!u) return;
  const av = $('#avatar'); if (av) { av.textContent = initials(u); av.title = u.full_name || u.email || ''; }
  const n = $('#acct-name'); if (n) n.textContent = displayName(u);
  const e = $('#acct-email'); if (e) e.textContent = u.email || '';
}

export function startNav() {
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
