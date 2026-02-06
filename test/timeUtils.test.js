const { nowIso, toIsoDate } = require('../src/shared/timeUtils');

describe('timeUtils', () => {
  test('nowIso returns iso string', () => {
    expect(nowIso()).toMatch(/T/);
  });

  test('toIsoDate handles invalid input', () => {
    expect(toIsoDate('invalid')).toBeNull();
  });

  test('toIsoDate returns date string', () => {
    expect(toIsoDate('2024-01-02T10:00:00.000Z')).toBe('2024-01-02');
  });
});
