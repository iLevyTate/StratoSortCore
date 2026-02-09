/**
 * Tests for systemSlice notification count drift fix.
 * Verifies unreadNotificationCount is always derived from the array,
 * preventing drift under concurrent add/remove operations.
 */

jest.mock('../src/renderer/services/ipc', () => ({
  filesIpc: { getDocumentsPath: jest.fn() },
  systemIpc: { getConfigValue: jest.fn() }
}));

import systemReducer, {
  addNotification,
  removeNotification,
  markNotificationSeen,
  markNotificationDismissed,
  clearNotifications
} from '../src/renderer/store/slices/systemSlice';

describe('systemSlice – notification count drift prevention', () => {
  /** Helper: apply a sequence of actions and return final state. */
  const applyActions = (actions) =>
    actions.reduce((state, action) => systemReducer(state, action), undefined);

  test('count stays correct after rapid add+remove interleaving', () => {
    // Add 3, remove 2, count should be 1
    let state = applyActions([
      addNotification({ id: 'a', message: 'A', severity: 'info' }),
      addNotification({ id: 'b', message: 'B', severity: 'info' }),
      addNotification({ id: 'c', message: 'C', severity: 'info' })
    ]);
    expect(state.unreadNotificationCount).toBe(3);

    state = systemReducer(state, removeNotification('a'));
    state = systemReducer(state, removeNotification('b'));
    expect(state.unreadNotificationCount).toBe(1);
    expect(state.notifications).toHaveLength(1);
  });

  test('removing an already-seen notification does not decrement below actual unread', () => {
    let state = applyActions([
      addNotification({ id: 'x', message: 'X', severity: 'info' }),
      addNotification({ id: 'y', message: 'Y', severity: 'info' })
    ]);
    // Mark x as seen (unread drops to 1)
    state = systemReducer(state, markNotificationSeen('x'));
    expect(state.unreadNotificationCount).toBe(1);

    // Remove the already-seen notification – count should remain 1
    state = systemReducer(state, removeNotification('x'));
    expect(state.unreadNotificationCount).toBe(1);
    expect(state.notifications).toHaveLength(1);
  });

  test('removing a non-existent ID does not produce negative count', () => {
    let state = applyActions([addNotification({ id: 'z', message: 'Z', severity: 'info' })]);
    // Remove a bogus ID twice
    state = systemReducer(state, removeNotification('does-not-exist'));
    state = systemReducer(state, removeNotification('does-not-exist'));
    expect(state.unreadNotificationCount).toBe(1);
  });

  test('dismiss then remove keeps count correct', () => {
    let state = applyActions([
      addNotification({ id: 'p', message: 'P', severity: 'info' }),
      addNotification({ id: 'q', message: 'Q', severity: 'info' })
    ]);
    state = systemReducer(state, markNotificationDismissed('p'));
    expect(state.unreadNotificationCount).toBe(1);

    state = systemReducer(state, removeNotification('p'));
    // After removing the dismissed one, only q remains (unread)
    expect(state.unreadNotificationCount).toBe(1);
  });

  test('clearNotifications always resets count to 0', () => {
    let state = applyActions([
      addNotification({ id: 'a', message: 'A', severity: 'info' }),
      addNotification({ id: 'b', message: 'B', severity: 'info' })
    ]);
    state = systemReducer(state, clearNotifications());
    expect(state.unreadNotificationCount).toBe(0);
    expect(state.notifications).toHaveLength(0);
  });
});
