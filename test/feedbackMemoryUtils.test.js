jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1')
}));

const {
  normalizeText,
  parseRuleFromText,
  buildMemoryEntry,
  applyMemoryRuleAdjustments
} = require('../src/main/services/organization/feedbackMemoryUtils');

describe('feedbackMemoryUtils', () => {
  test('normalizeText trims and caps length', () => {
    const result = normalizeText('  hello  ');
    expect(result).toBe('hello');
  });

  test('parseRuleFromText extracts extension rule', () => {
    const result = parseRuleFromText('.pdf -> Finance');
    expect(result.targetFolder).toBe('Finance');
    expect(result.rules[0]).toMatchObject({
      type: 'extension_to_folder',
      extension: 'pdf',
      folder: 'Finance'
    });
  });

  test('buildMemoryEntry returns null for empty input', () => {
    expect(buildMemoryEntry('')).toBeNull();
  });

  test('applyMemoryRuleAdjustments boosts matching folder', () => {
    const result = applyMemoryRuleAdjustments({
      fileExtension: '.pdf',
      suggestionFolder: 'Finance',
      rules: [{ type: 'extension_to_folder', extension: 'pdf', folder: 'Finance' }]
    });
    expect(result.boost).toBeGreaterThan(0);
  });
});
