// Log in, register (with the emailed code), forgotten and reset password. Passwords go straight from the form to the
// account service over HTTPS; this site never stores them.
import { $, esc, go, safeReturn, toast } from './core.js';
import { auth, signedIn } from './api.js';

const AFTER_PLAN = { household: 'twin/', academic: 'plans/?apply=academic', industry: 'contact/' };
const INPUT = 'flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-12';
const PRIMARY = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 px-4 py-2 w-full h-12 font-medium';

const qs = () => new URLSearchParams(location.search);
/** Where to go once signed in: the chosen plan's next step, else the page that sent the user here, else home. */
const destination = () => AFTER_PLAN[qs().get('plan')] || safeReturn(qs().get('returnTo')) || '';
const card = () => $('.bg-card');

function setError(msg) {
  let box = $('#auth-error');
  if (!box) { box = document.createElement('div'); box.id = 'auth-error'; box.className = 'mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm'; box.setAttribute('role', 'alert'); card().prepend(box); }
  box.textContent = msg || ''; box.hidden = !msg;
}
function busy(btn, on, label) { btn.disabled = on; btn.innerHTML = on ? `<span class="spinner"></span> ${esc(label)}` : esc(label); }
function heading(title, subtitle) { $('h1').textContent = title; $('h1 + p').textContent = subtitle; }
/** Carry ?plan and ?returnTo across the "Create one" / "Log in" links */
function keepQuery() {
  const keep = new URLSearchParams(); for (const k of ['plan', 'returnTo']) if (qs().get(k)) keep.set(k, qs().get(k));
  const tail = keep.toString(); if (!tail) return;
  document.querySelectorAll('a[href$="register/"], a[href$="login/"]').forEach(a => { a.href += '?' + tail; });
}
function wireGoogle() {
  const b = [...document.querySelectorAll('button')].find(x => /Continue with Google/.test(x.textContent));
  if (b) b.addEventListener('click', () => auth.startGoogle(destination()));
}

export function startLogin() {
  if (signedIn()) { go(destination()); return; }
  keepQuery(); wireGoogle();
  const f = $('form'), btn = $('button[type=submit]', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); setError(''); busy(btn, true, 'Logging in...');
    try { await auth.login($('#email').value.trim(), $('#password').value); go(destination()); }
    catch (x) { setError(x.status === 401 || x.status === 400 ? (x.message || 'Invalid email or password') : x.message); busy(btn, false, 'Log in'); }
  });
}

export function startRegister() {
  if (signedIn()) { go(destination()); return; }
  keepQuery(); wireGoogle();
  const f = $('form'), btn = $('button[type=submit]', f);
  const preset = qs().get('email'); if (preset) $('#email').value = preset;
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); setError('');
    const email = $('#email').value.trim(), pw = $('#password').value;
    if (pw !== $('#confirm').value) { setError('Passwords do not match'); return; }
    busy(btn, true, 'Creating account...');
    try { await auth.register(email, pw); verifyStep(email); }
    catch (x) { setError(x.message || 'Registration failed'); busy(btn, false, 'Create account'); }
  });
}

function verifyStep(email) {
  heading('Verify your email', `We sent a code to ${email}`);
  card().innerHTML = `<form class="space-y-4" id="otp-form"><div class="space-y-2"><label class="text-sm font-medium leading-none" for="otp">Verification code</label>
    <input id="otp" class="${INPUT} otp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" required autofocus></div>
    <button class="${PRIMARY}" type="submit">Verify</button></form>
    <p class="text-center text-sm text-muted-foreground mt-4">Didn't receive the code? <button class="auth-link-btn text-primary font-medium hover:underline" id="otp-resend" type="button">Resend</button></p>`;
  document.querySelectorAll('.max-w-md > p').forEach(p => p.remove());
  const f = $('#otp-form'), btn = $('button[type=submit]', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); setError(''); busy(btn, true, 'Verifying...');
    try { await auth.verifyOtp(email, $('#otp').value.trim()); go(destination()); }
    catch (x) { setError(x.message || 'Invalid verification code'); busy(btn, false, 'Verify'); }
  });
  $('#otp-resend').addEventListener('click', async () => {
    setError('');
    try { await auth.resendOtp(email); toast('Code sent', 'Check your email for the new code.'); }
    catch (x) { setError(x.message || 'Failed to resend code'); }
  });
}

export function startForgot() {
  const f = $('form'), btn = $('button[type=submit]', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const email = $('#email').value.trim(); busy(btn, true, 'Sending...');
    try { await auth.resetPasswordRequest(email); } catch (x) { /* same message either way, so the form does not reveal who has an account */ }
    heading('Check your email', 'A reset link is on its way');
    card().innerHTML = `<p class="text-sm text-foreground text-center">If an account exists for <b>${esc(email)}</b>, we've sent a link to reset the password. It can take a minute to arrive.</p>`;
  });
}

export function startReset() {
  const token = qs().get('token'); if (!token) return;   // the page as built says the link is invalid
  history.replaceState(null, '', location.pathname);     // keep the token out of the address bar and history
  heading('New password', 'Enter your new password below');
  card().innerHTML = `<form class="space-y-4"><div class="space-y-2"><label class="text-sm font-medium leading-none" for="password">New Password</label>
    <input id="password" type="password" class="${INPUT}" autocomplete="new-password" placeholder="••••••••" required autofocus></div>
    <div class="space-y-2"><label class="text-sm font-medium leading-none" for="confirm">Confirm Password</label>
    <input id="confirm" type="password" class="${INPUT}" autocomplete="new-password" placeholder="••••••••" required></div>
    <button class="${PRIMARY}" type="submit">Reset password</button></form>`;
  const p = $('.max-w-md > p'); if (p) p.remove();
  const f = $('form'), btn = $('button[type=submit]', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); setError('');
    if ($('#password').value !== $('#confirm').value) { setError('Passwords do not match'); return; }
    busy(btn, true, 'Resetting...');
    try { await auth.resetPassword(token, $('#password').value); go('login/'); }
    catch (x) { setError(x.message || 'Failed to reset password'); busy(btn, false, 'Reset password'); }
  });
}
