/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../src/renderer/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }) => <button {...props}>{children}</button>
}));
jest.mock('../../src/renderer/components/ui/IconButton', () => ({
  __esModule: true,
  default: ({ icon, ...props }) => (
    <button {...props}>
      {icon}
      refresh
    </button>
  )
}));
jest.mock('../../src/renderer/components/settings/SettingsCard', () => ({
  __esModule: true,
  default: ({ children, headerAction }) => (
    <div>
      {headerAction}
      {children}
    </div>
  )
}));
jest.mock('../../src/renderer/components/ui/StateMessage', () => ({
  __esModule: true,
  default: ({ title }) => <div>{title}</div>
}));
jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Text: ({ children }) => <span>{children}</span>
}));
jest.mock('../../src/shared/logger', () => ({
  createLogger: () => ({ debug: jest.fn() })
}));

import SettingsBackupSection from '../../src/renderer/components/settings/SettingsBackupSection';

describe('SettingsBackupSection', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  test('does not set state after unmount during async backup load', async () => {
    let resolveBackups;
    const listBackupsPromise = new Promise((resolve) => {
      resolveBackups = resolve;
    });

    window.electronAPI = {
      settings: {
        listBackups: jest.fn(() => listBackupsPromise)
      }
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<SettingsBackupSection addNotification={jest.fn()} />);

    unmount();
    await act(async () => {
      resolveBackups({ success: true, backups: [{ path: '/tmp/a', name: 'a' }] });
      await listBackupsPromise;
    });

    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toMatch(/unmounted component/i);
    consoleSpy.mockRestore();
  });
});
