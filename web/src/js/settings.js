// Settings: display name, sky theme, plan and sign-out. Saved on the user's account (settings.display_name, settings.theme).
import { $, go, toast } from './core.js';
import { auth, signedIn, displayName, initials, planKey, PLAN_NAMES, siteLimit, SolarSite } from './api.js';
import { theme } from './theme.js';

export async function startSettings() {
  if (!signedIn()) { go('login/?returnTo=' + encodeURIComponent('settings/')); return; }
  let me;
  try { me = await auth.me({ fresh: true }); } catch (e) { if (!signedIn()) go('login/?returnTo=' + encodeURIComponent('settings/')); else toast('Could not load your settings', e.message, 'bad'); return; }
  const name = $('#set-name'), mode = $('#set-theme'), saved = $('#set-saved');
  name.value = (me.settings && me.settings.display_name) || me.full_name || '';
  mode.value = (me.settings && me.settings.theme) || 'auto';
  $('#set-email').textContent = me.email || '';
  const plan = planKey(me.plan), limit = siteLimit(me.plan);
  $('#set-plan').textContent = PLAN_NAMES[plan];
  SolarSite.count({ created_by_id: me.id }).then(n => { $('#set-sites').textContent = `${n} saved site${n === 1 ? '' : 's'}${Number.isFinite(limit) ? ` of ${limit}` : ''}`; }).catch(() => {});
  async function save(patch, after) {
    saved.textContent = 'Saving…';
    try {
      me = await auth.updateMe({ settings: { ...(me.settings || {}), ...patch } }) || me;
      me = await auth.me({ fresh: true });
      saved.textContent = 'Saved'; setTimeout(() => { saved.textContent = ''; }, 2500);
      if (after) after();
      const nm = $('#acct-name'), av = $('#avatar'); if (nm) nm.textContent = displayName(me); if (av) av.textContent = initials(me);
    } catch (e) { saved.textContent = ''; toast('Could not save', e.message, 'bad'); }
  }
  name.addEventListener('change', () => save({ display_name: name.value.trim() }));
  mode.addEventListener('change', () => { theme.setMode(mode.value); save({ theme: mode.value }); });
}
