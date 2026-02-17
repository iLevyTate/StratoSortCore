/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('lucide-react', () => ({
  X: (props) => <svg data-testid="icon-x" {...props} />,
  AlertTriangle: (props) => <svg data-testid="icon-alert-triangle" {...props} />,
  Info: (props) => <svg data-testid="icon-info" {...props} />,
  HelpCircle: (props) => <svg data-testid="icon-help-circle" {...props} />,
  FileText: (props) => <svg data-testid="icon-file-text" {...props} />
}));

jest.mock('../../src/renderer/components/ui/IconButton', () => ({
  __esModule: true,
  default: ({ children, ...props }) => <button {...props}>{children}</button>
}));

jest.mock('../../src/renderer/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }) => <button {...props}>{children}</button>
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Heading: ({ as: Component = 'h3', children, ...props }) => (
    <Component {...props}>{children}</Component>
  ),
  Text: ({ as: Component = 'span', children, ...props }) => (
    <Component {...props}>{children}</Component>
  )
}));

import Modal from '../../src/renderer/components/ui/Modal';
import SidePanel from '../../src/renderer/components/ui/SidePanel';

describe('Overlay pointer-events regression guards', () => {
  test('Modal uses pointer-events-none when overlay close is disabled', () => {
    render(
      <Modal
        isOpen={true}
        onClose={jest.fn()}
        title="Test Modal"
        closeOnOverlayClick={false}
        closeOnEsc={false}
      >
        Body
      </Modal>
    );

    const overlay = document.body.querySelector('div[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).not.toContain('pointer-events-auto');
  });

  test('Modal uses pointer-events-auto when overlay close is enabled', () => {
    render(
      <Modal
        isOpen={true}
        onClose={jest.fn()}
        title="Test Modal"
        closeOnOverlayClick={true}
        closeOnEsc={false}
      >
        Body
      </Modal>
    );

    const overlay = document.body.querySelector('div[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay.className).toContain('pointer-events-auto');
  });

  test('SidePanel uses pointer-events-none when overlay close is disabled', () => {
    render(
      <SidePanel
        isOpen={true}
        onClose={jest.fn()}
        title="Panel"
        showOverlay={true}
        closeOnOverlayClick={false}
      >
        Content
      </SidePanel>
    );

    const overlay = document.body.querySelector('div[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).not.toContain('pointer-events-auto');
  });

  test('SidePanel uses pointer-events-auto when overlay close is enabled', () => {
    render(
      <SidePanel
        isOpen={true}
        onClose={jest.fn()}
        title="Panel"
        showOverlay={true}
        closeOnOverlayClick={true}
      >
        Content
      </SidePanel>
    );

    const overlay = document.body.querySelector('div[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay.className).toContain('pointer-events-auto');
  });
});
