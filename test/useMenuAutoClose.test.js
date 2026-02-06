import { renderHook, act } from '@testing-library/react';
import { useMenuAutoClose } from '../src/renderer/hooks/useMenuAutoClose';

describe('useMenuAutoClose', () => {
  let menu;
  let outside;
  let menuRef;

  beforeEach(() => {
    menu = document.createElement('div');
    outside = document.createElement('div');
    document.body.appendChild(menu);
    document.body.appendChild(outside);
    menuRef = { current: menu };
  });

  afterEach(() => {
    menu.remove();
    outside.remove();
  });

  test('closes when clicking outside', () => {
    const onClose = jest.fn();

    renderHook(() => useMenuAutoClose(menuRef, true, onClose));

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  test('does not close when clicking inside', () => {
    const onClose = jest.fn();
    const inside = document.createElement('span');
    menu.appendChild(inside);

    renderHook(() => useMenuAutoClose(menuRef, true, onClose));

    act(() => {
      inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  test('closes on Escape key', () => {
    const onClose = jest.fn();

    renderHook(() => useMenuAutoClose(menuRef, true, onClose));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  test('uses latest onClose callback', () => {
    const onClose1 = jest.fn();
    const onClose2 = jest.fn();

    const { rerender } = renderHook(({ onClose }) => useMenuAutoClose(menuRef, true, onClose), {
      initialProps: { onClose: onClose1 }
    });

    rerender({ onClose: onClose2 });

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose1).not.toHaveBeenCalled();
    expect(onClose2).toHaveBeenCalled();
  });

  test('does nothing when menu is closed', () => {
    const onClose = jest.fn();

    renderHook(() => useMenuAutoClose(menuRef, false, onClose));

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
