const path = require('path');
const { SemanticRenameService } = require('../src/main/services/SemanticRenameService');

// Mock logger to prevent console noise during tests
jest.mock('../src/shared/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('SemanticRenameService', () => {
  let service;

  beforeEach(() => {
    service = new SemanticRenameService();
    service.resetCache();
  });

  const mockAnalysis = {
    date: '2023-10-15',
    entity: 'Amazon',
    type: 'Invoice',
    project: 'Office Supplies',
    category: 'Expenses',
    summary: 'Invoice for monitor',
    keywords: ['monitor', 'screen'],
    confidence: 95
  };

  test('should generate name based on simple template', () => {
    const template = '{date}_{entity}_{type}';
    const filePath = '/docs/scan001.pdf';

    const result = service.generateNewName(filePath, mockAnalysis, template);
    // Path separator handling for cross-platform test compatibility
    const expectedEnd = `2023-10-15_Amazon_Invoice.pdf`;
    expect(result.endsWith(expectedEnd)).toBe(true);
  });

  test('should handle missing fields gracefully', () => {
    const template = '{date}_{entity}_{type}';
    const filePath = '/docs/scan001.pdf';
    const incompleteAnalysis = { ...mockAnalysis, entity: null, type: null };

    const result = service.generateNewName(filePath, incompleteAnalysis, template);
    // Default fallback values from namingUtils (formatDate(today) for date, 'Unknown' for entity)
    expect(result).toContain('Unknown');
    expect(result).toContain('Document'); // Default type
  });

  test('should handle collisions within the same batch', () => {
    const template = '{entity}_{type}';
    const filePath1 = '/docs/file1.pdf';
    const filePath2 = '/docs/file2.pdf';

    const result1 = service.generateNewName(filePath1, mockAnalysis, template);
    const result2 = service.generateNewName(filePath2, mockAnalysis, template);

    expect(result1).not.toEqual(result2);
    // Expect numeric suffix for the second one
    expect(result2).toMatch(/-2\.pdf$/);
  });

  test('should sanitize illegal characters', () => {
    const template = '{entity}_{type}';
    const filePath = '/docs/file1.pdf';
    const dirtyAnalysis = { ...mockAnalysis, entity: 'Acme/Corp:Inc' };

    const result = service.generateNewName(filePath, dirtyAnalysis, template);
    expect(result).not.toContain('/');
    expect(result).not.toContain(':');
    // Spaces are collapsed in processTemplate: "Acme/Corp:Inc" -> "Acme Corp Inc" -> "Acme_Corp_Inc"
    // or just removed if they are delimiters.
    // The implementation removes illegal chars: "Acme/Corp:Inc" -> "AcmeCorpInc"
    expect(result).toContain('AcmeCorpInc');
  });
});
