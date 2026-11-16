// "Talk to sales": emails the enquiry to the ARIEN team and saves it as a SalesLead in the ARIEN app.
import { $ } from './core.js';
import { auth, signedIn, SalesLead } from './api.js';
import { notifyTeam } from './notify.js';

export function startContact() {
  const f = $('#contact-form'), err = $('#contact-err');
  $('#back').addEventListener('click', () => (history.length > 1 ? history.back() : (location.href = document.documentElement.dataset.root || './')));
  if (signedIn()) auth.me().then(u => { if (!f.elements.name.value) f.elements.name.value = u.full_name || ''; if (!f.elements.email.value) f.elements.email.value = u.email || ''; }).catch(() => {});
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const btn = $('button[type=submit]', f), label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    const v = (n) => f.elements[n].value, num = (n) => (v(n) === '' ? undefined : Number(v(n)));
    try {
      // the enquiry counts as sent if the email or the saved record got through
      const done = await Promise.allSettled([
        notifyTeam(`ARIEN enquiry from ${v('name')}${v('organisation') ? ' (' + v('organisation') + ')' : ''}`, [['Name', v('name')], ['Email', v('email')], ['Organisation', v('organisation')], ['Role', v('role')],
          ['Number of sites', v('num_sites')], ['Total capacity (MWp)', v('capacity_mwp')], ['Use case', v('use_case')]]),
        SalesLead.create({ name: v('name'), email: v('email'), organisation: v('organisation'), role: v('role'), num_sites: num('num_sites'), capacity_mwp: num('capacity_mwp'), use_case: v('use_case') || undefined })
      ]);
      if (!done.some(r => r.status === 'fulfilled' && r.value !== false)) throw new Error('not sent');
      f.outerHTML = `<div class="card" style="text-align: center; padding: 48px;"><div style="font-size: 42px; margin-bottom: 12px;">✅</div><h3>Thanks. We'll reply within 2 working days.</h3><a class="btn btn-primary" style="margin-top: 24px;" href="${document.documentElement.dataset.root || './'}">Back to home</a></div>`;
    } catch (x) { err.textContent = 'Something went wrong. Please try again.'; err.hidden = false; btn.disabled = false; btn.innerHTML = label; }
  });
}
