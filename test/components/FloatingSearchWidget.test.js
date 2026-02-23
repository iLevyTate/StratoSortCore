/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  IconButton: ({ icon, children, ...props }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  )
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Heading: ({ as: Component = 'h4', children, ...props }) => (
    <Component {...props}>{children}</Component>
  ),
  Text: ({ as: Component = 'span', children, ...props }) => (
    <Component {...props}>{children}</Component>
  )
}));

jest.mock('../../src/renderer/utils/platform', () => ({
  isMac: false
}));

jest.mock('lucide-react', () => ({
  X: (props) => <svg data-testid="icon-x" {...props} />,
  GripVertical: (props) => <svg data-testid="icon-grip" {...props} />,
  Network: (props) => <svg data-testid="icon-network" {...props} />
}));

import FloatingSearchWidget from '../../src/renderer/components/search/FloatingSearchWidget';

describe('FloatingSearchWidget', () => {
  let getComputedStyleSpy;

  beforeEach(() => {
    localStorage.clear();
    getComputedStyleSpy = jest.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (key) => (key === '--app-nav-height' ? '72px' : '')
    });
  });

  afterEach(() => {
    getComputedStyleSpy.mockRestore();
  });

  test('clamps restored widget position below navigation header', async () => {
    localStorage.setItem('floatingSearchWidgetPosition', JSON.stringify({ x: 12, y: 0 }));

    const { container } = render(
      <FloatingSearchWidget isOpen onClose={jest.fn()} onOpenSearch={jest.fn()} />
    );

    const title = screen.getByText(/looking for a file\?/i);
    const widgetRoot = title.closest('.fixed');
    expect(widgetRoot).toBeInTheDocument();

    await waitFor(() => {
      expect(widgetRoot.style.top).toBe('80px');
      expect(widgetRoot.style.left).toBe('12px');
    });

    expect(container.querySelector('.glass-panel')).toBeInTheDocument();
  });

  test('clamps Y position to header-safe offset when dragged above header', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });

    const { container } = render(
      <FloatingSearchWidget isOpen onClose={jest.fn()} onOpenSearch={jest.fn()} />
    );

    const dragHandle = container.querySelector('[data-drag-handle]');
    expect(dragHandle).toBeInTheDocument();

    const widgetRoot = container.querySelector('.fixed');
    expect(widgetRoot).toBeInTheDocument();

    fireEvent.mouseDown(dragHandle, { clientX: 160, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 10 });

    await waitFor(() => {
      expect(widgetRoot.style.top).toBe('80px');
    });

    fireEvent.mouseUp(document);
  });

  test('uses z-index token so widget layers above header', () => {
    const { container } = render(
      <FloatingSearchWidget isOpen onClose={jest.fn()} onOpenSearch={jest.fn()} />
    );

    const widgetRoot = container.querySelector('.fixed');
    expect(widgetRoot).toBeInTheDocument();
    expect(widgetRoot.style.zIndex).toBe('var(--z-toast)');
  });
});
