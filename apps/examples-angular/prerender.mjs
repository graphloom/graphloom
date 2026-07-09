// Prerenders the built client index.html through platform-server so the
// served page is real SSR output — the target of the hydration smoke e2e.
import { readFileSync, writeFileSync } from 'node:fs';

const render = (await import('./dist/server/main.server.js')).default;
const html = await render(readFileSync('dist/client/index.html', 'utf8'), '/');
writeFileSync('dist/client/index.html', html);
console.log('prerendered dist/client/index.html');
