const { PHASE_ORDER, PHASE_TRANSITIONS } = require('../src/shared/constants');
const { canTransitionTo } = require('../src/renderer/store/slices/uiSlice');

describe('phase transition consistency', () => {
  test('PHASE_ORDER contains unique phase ids', () => {
    expect(Array.isArray(PHASE_ORDER)).toBe(true);
    expect(PHASE_ORDER.length).toBeGreaterThan(0);
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  test('PHASE_TRANSITIONS only reference known phases', () => {
    const known = new Set(PHASE_ORDER);
    for (const [from, toList] of Object.entries(PHASE_TRANSITIONS)) {
      expect(known.has(from)).toBe(true);
      expect(Array.isArray(toList)).toBe(true);
      for (const to of toList) {
        expect(known.has(to)).toBe(true);
      }
    }
  });

  test('canTransitionTo matches transition graph for every phase pair', () => {
    for (const from of PHASE_ORDER) {
      for (const to of PHASE_ORDER) {
        if (from === to) {
          expect(canTransitionTo(from, to)).toBe(true);
          continue;
        }
        const expected = (PHASE_TRANSITIONS[from] || []).includes(to);
        expect(canTransitionTo(from, to)).toBe(expected);
      }
    }
  });
});
