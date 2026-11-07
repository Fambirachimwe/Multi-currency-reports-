import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';

describe('App (bootstrap placeholder)', () => {
  it('renders the application title', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Multi-Currency Sales Reporting');
  });
});
