/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { NotificationProvider } from '../src/renderer/contexts/NotificationContext';
import { markNotificationDismissed } from '../src/renderer/store/slices/systemSlice';

const mockDispatch = jest.fn();
const mockAddToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockClearAllToasts = jest.fn();
const mockShowSuccess = jest.fn();
const mockShowError = jest.fn();
const mockShowWarning = jest.fn();
const mockShowInfo = jest.fn();
const mockDrainEvictedIds = jest.fn();

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch
}));

jest.mock('../src/renderer/components/Toast', () => ({
  ToastContainer: () => null,
  useToast: () => ({
    toasts: [],
    addToast: mockAddToast,
    removeToast: mockRemoveToast,
    clearAllToasts: mockClearAllToasts,
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: mockShowWarning,
    showInfo: mockShowInfo,
    drainEvictedIds: mockDrainEvictedIds
  })
}));

describe('NotificationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDrainEvictedIds.mockReturnValue([]);
    mockShowSuccess.mockReturnValue('toast-success');
    mockShowError.mockReturnValue('toast-error');
    mockShowWarning.mockReturnValue('toast-warning');
    mockShowInfo.mockReturnValue('toast-info');
  });

  it('dismisses Redux notifications for toasts evicted on app notifications', () => {
    mockShowSuccess.mockReturnValueOnce('toast-1').mockReturnValueOnce('toast-2');
    mockDrainEvictedIds.mockReturnValueOnce([]).mockReturnValueOnce(['toast-1']);

    render(
      <NotificationProvider>
        <div data-testid="child" />
      </NotificationProvider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('app:notification', {
          detail: { id: 'notif-1', message: 'First', severity: 'success', duration: 1000 }
        })
      );
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('app:notification', {
          detail: { id: 'notif-2', message: 'Second', severity: 'success', duration: 1000 }
        })
      );
    });

    expect(mockDispatch).toHaveBeenCalledWith(markNotificationDismissed('notif-1'));
  });
});
