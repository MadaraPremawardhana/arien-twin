// Entry point for every page. Each page's <body data-page="…"> picks what runs.
import { startTheme } from './theme.js';
import { startNav } from './nav.js';

const page = document.body.dataset.page;
startTheme();
startNav();
const run = {
  home: () => import('./home.js').then(m => m.startHome()),
  plans: () => import('./plans.js').then(m => m.startPlans()),
  contact: () => import('./contact.js').then(m => m.startContact()),
  login: () => import('./authpages.js').then(m => m.startLogin()),
  register: () => import('./authpages.js').then(m => m.startRegister()),
  forgot: () => import('./authpages.js').then(m => m.startForgot()),
  reset: () => import('./authpages.js').then(m => m.startReset()),
  twin: () => import('./twinhost.js').then(m => m.startTwinHost('design')),
  dashboard: () => import('./twinhost.js').then(m => m.startTwinHost('dashboard')),
  settings: () => import('./settings.js').then(m => m.startSettings())
}[page];
if (run) run().catch(e => console.error(e));
