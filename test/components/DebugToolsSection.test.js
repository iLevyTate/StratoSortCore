/**
 * @jest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DebugToolsSection from '../../src/renderer/components/settings/DebugToolsSection';
import { DEBUG_STORAGE_KEYS } from '../../src/renderer/utils/debugFlags';

describe('DebugToolsSection', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    window.localStorage.clear();
  });

  test('does not render outside development builds', () => {
    process.env.NODE_ENV = 'production';

    const { container } = render(<DebugToolsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  test('enables debug mode and wizard force flags', () => {
    process.env.NODE_ENV = 'development';
    const addNotification = jest.fn();

    render(<DebugToolsSection addNotification={addNotification} />);

    let switches = screen.getAllByRole('switch');
    const debugSwitch = switches[0];
    expect(switches[1]).toBeDisabled();

    fireEvent.click(debugSwitch);
    expect(window.localStorage.getItem(DEBUG_STORAGE_KEYS.debugMode)).toBe('1');

    switches = screen.getAllByRole('switch');
    const forceWizardSwitch = switches[1];
    expect(forceWizardSwitch).not.toBeDisabled();

    fireEvent.click(forceWizardSwitch);
    expect(window.localStorage.getItem(DEBUG_STORAGE_KEYS.forceModelWizard)).toBe('1');
    expect(addNotification).toHaveBeenCalled();
  });

  test('disabling debug mode clears force wizard flag', () => {
    process.env.NODE_ENV = 'development';
    window.localStorage.setItem(DEBUG_STORAGE_KEYS.debugMode, '1');
    window.localStorage.setItem(DEBUG_STORAGE_KEYS.forceModelWizard, '1');

    render(<DebugToolsSection />);
    const switches = screen.getAllByRole('switch');

    fireEvent.click(switches[0]);

    expect(window.localStorage.getItem(DEBUG_STORAGE_KEYS.debugMode)).toBeNull();
    expect(window.localStorage.getItem(DEBUG_STORAGE_KEYS.forceModelWizard)).toBeNull();
  });
});
