import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/error-boundary';

let shouldThrow = true;

function Bomb() {
  if (shouldThrow) throw new Error('secret internal detail');
  return <p>Recovered content</p>;
}

function Harness() {
  return (
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  );
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    shouldThrow = true;
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>Healthy</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows a generic fallback without leaking the error message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
  });

  it('recovers when the user retries after the cause is fixed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness />);
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });
});
