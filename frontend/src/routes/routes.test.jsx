import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/routes/paths';
import { routes } from '@/routes/routes';

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('app routes', () => {
  it('renders the header and every primary navigation link', () => {
    renderAt('/');
    expect(screen.getByRole('banner')).toHaveTextContent('Multi-Currency Sales Reporting');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(NAV_ITEMS.map((item) => item.label));
  });

  it.each([
    ['/', 'Dashboard'],
    ['/reports/new', 'Generate Report'],
    ['/reports', 'Saved Reports'],
    ['/reports/abc123', 'Saved report'],
    ['/nodes', 'Nodes & Brands'],
    ['/settings', 'Settings'],
  ])('renders the page for %s', (path, title) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
  });

  it('marks only the current link as active', () => {
    renderAt('/reports/new');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const active = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(active.map((link) => link.textContent)).toEqual(['Generate Report']);
  });

  it('navigates when a sidebar link is clicked', async () => {
    const router = renderAt('/');
    await userEvent.click(screen.getByRole('link', { name: 'Saved Reports' }));
    expect(router.state.location.pathname).toBe('/reports');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Saved Reports');
  });

  it.each(['/does-not-exist', '/reports/abc/extra', '/catalog/x/y'])(
    'renders the 404 page inside the shell for %s',
    (path) => {
      renderAt(path);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
      expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/');
    },
  );

  it('shows no account or login controls (no authentication in v1)', () => {
    renderAt('/');
    expect(screen.queryByText(/log ?in|sign ?in|profile|account/i)).not.toBeInTheDocument();
  });
});
