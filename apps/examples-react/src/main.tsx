import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
// The built page is prerendered (see prerender.mjs) → hydrate; the dev
// server serves the raw template with an empty #root → fresh render.
if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);
