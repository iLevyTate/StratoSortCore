/**
 * Tests for confidence color utilities
 */

import { CONFIDENCE_COLORS, getConfidenceColor } from '../../src/renderer/utils/confidenceColors';

describe('confidenceColors', () => {
  describe('CONFIDENCE_COLORS constant', () => {
    it('should have high, medium, and low levels', () => {
      expect(CONFIDENCE_COLORS).toHaveProperty('high');
      expect(CONFIDENCE_COLORS).toHaveProperty('medium');
      expect(CONFIDENCE_COLORS).toHaveProperty('low');
    });

    it('should have required properties for high confidence', () => {
      const high = CONFIDENCE_COLORS.high;
      expect(high).toHaveProperty('bg');
      expect(high).toHaveProperty('text');
      expect(high).toHaveProperty('border');
      expect(high).toHaveProperty('dot');
      expect(high).toHaveProperty('dotBg');
      expect(high).toHaveProperty('label');
      expect(high).toHaveProperty('desc');
      expect(high).toHaveProperty('combined');
    });

    it('should have required properties for medium confidence', () => {
      const medium = CONFIDENCE_COLORS.medium;
      expect(medium).toHaveProperty('bg');
      expect(medium).toHaveProperty('text');
      expect(medium).toHaveProperty('border');
      expect(medium).toHaveProperty('dot');
      expect(medium).toHaveProperty('dotBg');
      expect(medium).toHaveProperty('label');
      expect(medium).toHaveProperty('desc');
      expect(medium).toHaveProperty('combined');
    });

    it('should have required properties for low confidence', () => {
      const low = CONFIDENCE_COLORS.low;
      expect(low).toHaveProperty('bg');
      expect(low).toHaveProperty('text');
      expect(low).toHaveProperty('border');
      expect(low).toHaveProperty('dot');
      expect(low).toHaveProperty('dotBg');
      expect(low).toHaveProperty('label');
      expect(low).toHaveProperty('desc');
      expect(low).toHaveProperty('combined');
    });

    it('should use design-system success colors for high confidence', () => {
      expect(CONFIDENCE_COLORS.high.bg).toContain('stratosort-success');
      expect(CONFIDENCE_COLORS.high.text).toContain('stratosort-success');
      expect(CONFIDENCE_COLORS.high.border).toContain('stratosort-success');
    });

    it('should use design-system blue colors for medium confidence', () => {
      expect(CONFIDENCE_COLORS.medium.bg).toContain('stratosort-blue');
      expect(CONFIDENCE_COLORS.medium.text).toContain('stratosort-blue');
      expect(CONFIDENCE_COLORS.medium.border).toContain('stratosort-blue');
    });

    it('should have gray colors for low confidence', () => {
      expect(CONFIDENCE_COLORS.low.bg).toContain('gray');
      expect(CONFIDENCE_COLORS.low.text).toContain('gray');
      expect(CONFIDENCE_COLORS.low.border).toContain('gray');
    });

    it('should have unique dot symbols for each level', () => {
      expect(CONFIDENCE_COLORS.high.dot).toBe('●');
      expect(CONFIDENCE_COLORS.medium.dot).toBe('◐');
      expect(CONFIDENCE_COLORS.low.dot).toBe('○');
    });
  });

  describe('getConfidenceColor', () => {
    it('should return correct classes for high confidence', () => {
      const result = getConfidenceColor('high');
      expect(result).toBe(
        'bg-stratosort-success/10 text-stratosort-success border-stratosort-success/30'
      );
    });

    it('should return correct classes for medium confidence', () => {
      const result = getConfidenceColor('medium');
      expect(result).toBe('bg-stratosort-blue/10 text-stratosort-blue border-stratosort-blue/30');
    });

    it('should return correct classes for low confidence', () => {
      const result = getConfidenceColor('low');
      expect(result).toBe('bg-system-gray-100 text-system-gray-600 border-system-gray-200');
    });

    it('should default to low for invalid input', () => {
      expect(getConfidenceColor('invalid')).toBe(CONFIDENCE_COLORS.low.combined);
      expect(getConfidenceColor('')).toBe(CONFIDENCE_COLORS.low.combined);
      expect(getConfidenceColor(null)).toBe(CONFIDENCE_COLORS.low.combined);
      expect(getConfidenceColor(undefined)).toBe(CONFIDENCE_COLORS.low.combined);
      expect(getConfidenceColor(123)).toBe(CONFIDENCE_COLORS.low.combined);
    });

    it('should be case sensitive', () => {
      expect(getConfidenceColor('HIGH')).toBe(CONFIDENCE_COLORS.low.combined);
      expect(getConfidenceColor('High')).toBe(CONFIDENCE_COLORS.low.combined);
    });
  });
});
