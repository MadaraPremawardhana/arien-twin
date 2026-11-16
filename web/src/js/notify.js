// Emails the ARIEN team (CONFIG.contactEmail) when someone sends an enquiry, joins the waitlist or applies for academic access.
import { CONFIG, esc } from './core.js';
import { sendEmail } from './api.js';

/** `fields` is a list of [label, value]; empty values are left out. Resolves true when the email was accepted. */
export async function notifyTeam(subject, fields) {
  if (!CONFIG.contactEmail) return false;
  const rows = fields.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6E6A85;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
  const body = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#16132B"><p style="margin:0 0 10px"><b>${esc(subject)}</b></p><table style="border-collapse:collapse">${rows}</table>`
    + `<p style="margin:14px 0 0;color:#6E6A85;font-size:12px">Sent from ${esc(location.origin + location.pathname)} on ${esc(new Date().toUTCString())}. Reply to the address above; this message comes from a no-reply sender.</p></div>`;
  await sendEmail({ to: CONFIG.contactEmail, subject: String(subject).slice(0, 150), body });
  return true;
}
