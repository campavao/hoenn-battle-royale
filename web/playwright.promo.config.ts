// Promo footage only (e2e/promo.spec.ts): the suite's servers, and one project with no
// device preset, because the take sets its own scale factor and a preset's would stop it.
import base from './playwright.config';

export default { ...base, projects: [{ name: 'promo', testMatch: 'promo.spec.ts', use: {} }] };
