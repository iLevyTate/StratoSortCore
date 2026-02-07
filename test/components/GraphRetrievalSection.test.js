/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../src/renderer/components/ui/Switch', () => ({
  __esModule: true,
  default: ({ checked, onChange }) => (
    <input
      data-testid="switch"
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange?.(e.target.checked)}
    />
  )
}));

jest.mock('../../src/renderer/components/ui/Input', () => ({
  __esModule: true,
  default: ({ value, onChange, ...props }) => <input value={value} onChange={onChange} {...props} />
}));

jest.mock('../../src/renderer/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }) => <button {...props}>{children}</button>
}));

jest.mock('../../src/renderer/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="card">{children}</div>
}));

jest.mock('../../src/renderer/components/settings/SettingRow', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="setting-row">{children}</div>
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Text: ({ children }) => <span>{children}</span>
}));

jest.mock('../../src/renderer/components/layout', () => ({
  Stack: ({ children }) => <div>{children}</div>
}));

jest.mock('../../src/shared/logger', () => ({
  logger: { debug: jest.fn() },
  createLogger: jest.fn(() => ({ debug: jest.fn() }))
}));

import GraphRetrievalSection from '../../src/renderer/components/settings/GraphRetrievalSection';

const baseSettings = {
  graphExpansionEnabled: true,
  graphExpansionWeight: 0.2,
  graphExpansionMaxNeighbors: 120,
  chunkContextEnabled: true,
  chunkContextMaxNeighbors: 1
};

describe('GraphRetrievalSection', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  test('disables refresh when knowledge API missing', () => {
    window.electronAPI = {};
    render(<GraphRetrievalSection settings={baseSettings} setSettings={jest.fn()} />);

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    expect(refreshButton).toBeDisabled();
  });

  test('does not update state after unmount during refresh', async () => {
    let resolveStats;
    const statsPromise = new Promise((resolve) => {
      resolveStats = resolve;
    });

    window.electronAPI = {
      knowledge: {
        getRelationshipStats: jest.fn(() => statsPromise)
      }
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(
      <GraphRetrievalSection settings={baseSettings} setSettings={jest.fn()} />
    );

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshButton);

    unmount();
    await act(async () => {
      resolveStats({ success: true, edgeCount: 1, conceptCount: 2, docCount: 3 });
      await statsPromise;
    });

    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toMatch(/unmounted component/i);
    consoleSpy.mockRestore();
  });
});
