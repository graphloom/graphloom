import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './app.js';

/** SSR entry: renders the app markup for prerender.mjs. */
export default function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
