// Plans page: what each plan's button does, the Pro waitlist and the academic-access application.
import { $, $$, go } from './core.js';
import { auth, signedIn, Waitlist, AcademicApplication } from './api.js';
import { openModal, doneHtml } from './modal.js';

const ACADEMIC_DOMAINS = ['.ac.uk', '.edu', '.edu.au', '.ac.lk', '.ac.in', '.ac.nz', '.ac.za'];
const isAcademic = (email) => ACADEMIC_DOMAINS.some(d => String(email || '').trim().toLowerCase().endsWith(d));
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? `<span class="spinner"></span> ${label}` : label; };

async function me() { try { return signedIn() ? await auth.me() : null; } catch (e) { return null; } }

async function waitlist() {
  const u = await me();
  const d = openModal({ title: 'Join the Pro / Installer waitlist', description: '£29 per seat / month · unlimited sites · PDF site reports · shading tool · 3D twin. No payment needed to join.',
    body: `<form><div><label for="wl-name">Name</label><input id="wl-name" name="name" required placeholder="Jane Smith"></div>
      <div><label for="wl-email">Email</label><input id="wl-email" name="email" type="email" required placeholder="jane@installer.co.uk"></div>
      <div><label for="wl-org">Organisation (optional)</label><input id="wl-org" name="organisation" placeholder="Sunrise Solar Ltd"></div>
      <div class="modal-err" hidden></div><button type="submit" class="btn">Join the waitlist</button></form>` });
  const f = $('form', d); f.elements.name.value = (u && u.full_name) || ''; f.elements.email.value = (u && u.email) || '';
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', f), err = $('.modal-err', f); err.hidden = true; busy(btn, true, 'Joining…');
    try {
      await Waitlist.create({ name: f.elements.name.value, email: f.elements.email.value, organisation: f.elements.organisation.value, interest: 'Pro / Installer' });
      $('.modal-body', d).innerHTML = doneHtml("You're on the list", "We'll email you as soon as Pro / Installer seats open up.");
    } catch (x) { err.textContent = x.message || 'Could not join the waitlist. Please try again.'; err.hidden = false; busy(btn, false, 'Join the waitlist'); }
  });
}

async function academic() {
  const u = await me();
  const d = openModal({ title: 'Academic access', description: 'Available to researchers and students with an institutional email address.',
    body: `<form><div><label for="ac-name">Full name</label><input id="ac-name" name="name" required placeholder="Dr. Jane Smith"></div>
      <div><label for="ac-inst">Institution</label><input id="ac-inst" name="institution" required placeholder="University of Bristol"></div>
      <div><label for="ac-email">Academic email</label><input id="ac-email" name="email" type="email" required placeholder="jane@bristol.ac.uk"></div>
      <div><label for="ac-use">Research use</label><textarea id="ac-use" name="research_use" rows="3" placeholder="Tell us how you plan to use Arien in your research..."></textarea></div>
      <div class="modal-err" hidden></div><button type="submit" class="btn">Apply</button></form>` });
  const f = $('form', d); f.elements.name.value = (u && u.full_name) || ''; f.elements.email.value = (u && u.email) || '';
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', f), err = $('.modal-err', f); err.hidden = true; busy(btn, true, 'Sending…');
    try {
      const ok = isAcademic(f.elements.email.value);
      await AcademicApplication.create({ name: f.elements.name.value, institution: f.elements.institution.value, email: f.elements.email.value, research_use: f.elements.research_use.value, status: ok ? 'approved' : 'pending' });
      if (ok) { await auth.updateMe({ plan: 'Academic' }); await auth.me({ fresh: true }).catch(() => {}); }
      $('.modal-body', d).innerHTML = ok
        ? doneHtml('Approved — Academic access activated', 'Your academic email was recognised, so your account has been upgraded to the Academic plan.')
        : doneHtml('Application received', "We'll review your application and reply within 2 working days.", false);
    } catch (x) { err.textContent = x.message || 'Could not submit your application. Please try again.'; err.hidden = false; busy(btn, false, 'Apply'); }
  });
}

export function startPlans() {
  const act = { household: () => go(signedIn() ? 'twin/' : 'register/?plan=household'), academic: () => (signedIn() ? academic() : go('register/?plan=academic')), pro: waitlist, industry: () => go('contact/') };
  $$('[data-plan]').forEach(b => b.addEventListener('click', () => act[b.dataset.plan]()));
  if (new URLSearchParams(location.search).get('apply') === 'academic' && signedIn()) academic();
}
