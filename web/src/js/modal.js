// A small accessible dialog (native <dialog>) for the waitlist and academic-access forms.
import { esc } from './core.js';

export function openModal({ title, description, body }) {
  const d = document.createElement('dialog'); d.className = 'modal';
  d.innerHTML = `<button class="modal-x" aria-label="Close" data-close><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
    <h2>${esc(title)}</h2><p class="modal-desc">${esc(description || '')}</p><div class="modal-body">${body}</div>`;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
export const doneHtml = (heading, text, good = true) => `<div class="modal-done">
  <div style="display: grid; place-items: center; margin-bottom: 10px;"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="${good ? '#1E9E6A' : '#D9870A'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${good ? '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>' : '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>'}</svg></div>
  <h3>${esc(heading)}</h3><p>${esc(text)}</p><button class="btn" data-close>Done</button></div>`;
