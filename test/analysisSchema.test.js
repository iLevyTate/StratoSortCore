const { ANALYSIS_SCHEMA_PROMPT, DEFAULT_ANALYSIS_RESULT } = require('../src/shared/analysisSchema');

describe('Extended Analysis Schema', () => {
  test('ANALYSIS_SCHEMA_PROMPT should be an object with required fields', () => {
    expect(typeof ANALYSIS_SCHEMA_PROMPT).toBe('object');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('date');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('entity');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('type');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('category');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('project');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('purpose');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('summary');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('keywords');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('confidence');
    expect(ANALYSIS_SCHEMA_PROMPT).toHaveProperty('suggestedName');
  });

  test('DEFAULT_ANALYSIS_RESULT should define default values', () => {
    expect(DEFAULT_ANALYSIS_RESULT).toEqual({
      date: null,
      entity: null,
      type: 'Document',
      category: 'Uncategorized',
      project: null,
      purpose: null,
      summary: '',
      keywords: [],
      confidence: 0,
      suggestedName: null,
      reasoning: null
    });
  });
});
