const {
  NotificationSeverity,
  getDefaultDuration,
  normalizeNotification,
  createNotification
} = require('../src/shared/notificationTypes');

describe('notificationTypes', () => {
  test('getDefaultDuration returns severity defaults', () => {
    expect(getDefaultDuration(NotificationSeverity.INFO)).toBeGreaterThan(0);
  });

  test('normalizeNotification maps legacy fields', () => {
    const normalized = normalizeNotification({ title: 'Hi', variant: 'warning' });
    expect(normalized.message).toBe('Hi');
    expect(normalized.severity).toBe('warning');
  });

  test('createNotification fills defaults', () => {
    const notif = createNotification({ message: 'Hello' });
    expect(notif.message).toBe('Hello');
    expect(notif.severity).toBe(NotificationSeverity.INFO);
  });
});
