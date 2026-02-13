/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { useToast } from '../../src/renderer/components/Toast';

describe('useToast', () => {
  it('returns the merged toast id for back-to-back grouped adds', () => {
    const { result } = renderHook(() => useToast());

    let firstId;
    let secondId;
    act(() => {
      firstId = result.current.addToast('First', 'info', 3000, 'group-1');
      secondId = result.current.addToast('Second', 'warning', 3000, 'group-1');
    });

    expect(secondId).toBe(firstId);
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].mergeCount).toBe(2);
  });
});
