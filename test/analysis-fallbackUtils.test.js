/**
 * Tests for Analysis Fallback Utils
 * Tests intelligent categorization, keyword extraction, and name sanitization
 */

describe('Analysis Fallback Utils', () => {
  let getIntelligentCategory;
  let getIntelligentKeywords;
  let safeSuggestedName;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/analysis/fallbackUtils');
    getIntelligentCategory = module.getIntelligentCategory;
    getIntelligentKeywords = module.getIntelligentKeywords;
    safeSuggestedName = module.safeSuggestedName;
  });

  describe('getIntelligentCategory', () => {
    describe('pattern-based categorization', () => {
      test('detects financial documents', () => {
        expect(getIntelligentCategory('invoice_2024.pdf', '.pdf')).toBe('financial');
        expect(getIntelligentCategory('tax_return.pdf', '.pdf')).toBe('financial');
        expect(getIntelligentCategory('payment_receipt.pdf', '.pdf')).toBe('financial');
        expect(getIntelligentCategory('budget_report.xlsx', '.xlsx')).toBe('financial');
      });

      test('detects legal documents', () => {
        expect(getIntelligentCategory('contract_agreement.pdf', '.pdf')).toBe('legal');
        expect(getIntelligentCategory('terms_of_service.pdf', '.pdf')).toBe('legal');
        expect(getIntelligentCategory('license_agreement.docx', '.docx')).toBe('legal');
      });

      test('detects project documents', () => {
        expect(getIntelligentCategory('project_plan.pdf', '.pdf')).toBe('project');
        expect(getIntelligentCategory('requirements_spec.docx', '.docx')).toBe('project');
        expect(getIntelligentCategory('proposal_draft.pdf', '.pdf')).toBe('project');
      });

      test('detects personal documents', () => {
        expect(getIntelligentCategory('resume_2024.pdf', '.pdf')).toBe('personal');
        expect(getIntelligentCategory('my_cv.docx', '.docx')).toBe('personal');
        expect(getIntelligentCategory('personal_notes.txt', '.txt')).toBe('personal');
      });

      test('detects technical documents', () => {
        expect(getIntelligentCategory('user_manual.pdf', '.pdf')).toBe('technical');
        expect(getIntelligentCategory('installation_guide.docx', '.docx')).toBe('technical');
        expect(getIntelligentCategory('api_documentation.md', '.md')).toBe('technical');
      });

      test('detects research documents', () => {
        expect(getIntelligentCategory('research_study.pdf', '.pdf')).toBe('research');
        expect(getIntelligentCategory('data_analysis.docx', '.docx')).toBe('research');
        expect(getIntelligentCategory('survey_findings.pdf', '.pdf')).toBe('research');
      });

      test('detects marketing documents', () => {
        expect(getIntelligentCategory('marketing_campaign.pptx', '.pptx')).toBe('marketing');
        expect(getIntelligentCategory('brand_strategy.pdf', '.pdf')).toBe('marketing');
        expect(getIntelligentCategory('advertisement_content.pdf', '.pdf')).toBe('marketing');
      });

      test('detects HR documents', () => {
        expect(getIntelligentCategory('employee_handbook.pdf', '.pdf')).toBe('hr');
        expect(getIntelligentCategory('hiring_policy.docx', '.docx')).toBe('hr');
        expect(getIntelligentCategory('performance_review.pdf', '.pdf')).toBe('hr');
      });
    });

    describe('extension-based fallback', () => {
      // Note: Function returns capitalized folder names to match typical smart folder names
      test('returns Documents for pdf files', () => {
        expect(getIntelligentCategory('random_file.pdf', '.pdf')).toBe('Documents');
      });

      test('returns Images for image files', () => {
        expect(getIntelligentCategory('photo.jpg', '.jpg')).toBe('Images');
        expect(getIntelligentCategory('icon.png', '.png')).toBe('Images');
      });

      test('returns Videos for video files', () => {
        expect(getIntelligentCategory('movie.mp4', '.mp4')).toBe('Videos');
      });

      test('returns Spreadsheets for spreadsheet files', () => {
        // Use filename that doesn't match any pattern keywords
        expect(getIntelligentCategory('numbers.xlsx', '.xlsx')).toBe('Spreadsheets');
      });

      test('returns Data for data files', () => {
        // Use filenames that don't match any pattern keywords
        expect(getIntelligentCategory('settings.json', '.json')).toBe('Data');
        expect(getIntelligentCategory('records.csv', '.csv')).toBe('Data');
      });

      test('returns Archives for archive files', () => {
        expect(getIntelligentCategory('files.zip', '.zip')).toBe('Archives');
      });

      test('returns Documents for unknown extensions', () => {
        expect(getIntelligentCategory('random.xyz', '.xyz')).toBe('Documents');
      });
    });

    describe('smart folder matching', () => {
      test('matches folder by name', () => {
        const smartFolders = [
          { name: 'Photos', path: '/Photos' },
          { name: 'Documents', path: '/Documents' }
        ];

        expect(getIntelligentCategory('vacation_photos.jpg', '.jpg', smartFolders)).toBe('Photos');
      });

      test('matches folder by description', () => {
        const smartFolders = [{ name: 'Work', description: 'Reports and analysis files' }];

        expect(getIntelligentCategory('quarterly_analysis.pdf', '.pdf', smartFolders)).toBe('Work');
      });

      test('matches folder by keywords', () => {
        // Need score >= 5 to match. Keywords give +4 each, so need 2 matches or use folder name
        const smartFolders = [{ name: 'Finance', keywords: ['invoice', 'receipt', 'payment'] }];

        // 'finance_invoice' gives: folder name match (+10) + keyword 'invoice' (+4) = 14
        expect(getIntelligentCategory('finance_invoice.pdf', '.pdf', smartFolders)).toBe('Finance');
      });

      test('matches folder by semantic tags', () => {
        const smartFolders = [
          { name: 'Projects', semanticTags: ['development', 'code', 'software'] }
        ];

        expect(getIntelligentCategory('software_design.pdf', '.pdf', smartFolders)).toBe(
          'Projects'
        );
      });

      test('falls back to pattern when score too low', () => {
        const smartFolders = [{ name: 'Other', path: '/Other' }];

        expect(getIntelligentCategory('invoice_2024.pdf', '.pdf', smartFolders)).toBe('financial');
      });

      test('handles empty smart folders array', () => {
        expect(getIntelligentCategory('invoice.pdf', '.pdf', [])).toBe('financial');
      });

      test('handles invalid smart folders', () => {
        const smartFolders = [null, { name: '' }, { name: null }, { name: 'Valid' }];

        // Should not crash
        expect(() => getIntelligentCategory('file.pdf', '.pdf', smartFolders)).not.toThrow();
      });
    });
  });

  describe('getIntelligentKeywords', () => {
    test('returns category-based keywords', () => {
      const keywords = getIntelligentKeywords('invoice.pdf', '.pdf');

      expect(keywords).toContain('financial');
    });

    test('adds keywords from filename', () => {
      const keywords = getIntelligentKeywords('quarterly_report_summary.pdf', '.pdf');

      expect(keywords).toContain('report');
      expect(keywords).toContain('summary');
    });

    test('adds extension as keyword', () => {
      const keywords = getIntelligentKeywords('file.pdf', '.pdf');

      expect(keywords).toContain('pdf');
    });

    test('limits keywords to 10 (increased to include semantic keywords)', () => {
      const keywords = getIntelligentKeywords(
        'report_summary_analysis_proposal_presentation.pdf',
        '.pdf'
      );

      // Limit increased from 7 to 10 to accommodate semantic extension keywords
      expect(keywords.length).toBeLessThanOrEqual(10);
    });

    test('handles unknown category', () => {
      const keywords = getIntelligentKeywords('random.xyz', '.xyz');

      expect(keywords).toContain('document');
    });
  });

  describe('safeSuggestedName', () => {
    test('preserves valid filename', () => {
      const result = safeSuggestedName('valid_file.pdf', '.pdf');

      expect(result).toBe('valid_file.pdf');
    });

    test('sanitizes invalid characters', () => {
      const result = safeSuggestedName('file<with>invalid:chars.pdf', '.pdf');

      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain(':');
      expect(result).toContain('.pdf');
    });

    test('replaces spaces with underscores', () => {
      const result = safeSuggestedName('file with spaces.pdf', '.pdf');

      expect(result).not.toContain(' ');
      expect(result).toContain('_');
    });

    test('handles reserved Windows names', () => {
      const result = safeSuggestedName('CON.pdf', '.pdf');

      expect(result).not.toBe('CON.pdf');
      expect(result).toContain('_file');
    });

    test('handles other reserved names', () => {
      expect(safeSuggestedName('PRN.txt', '.txt')).toContain('_file');
      expect(safeSuggestedName('AUX.doc', '.doc')).toContain('_file');
      expect(safeSuggestedName('NUL.pdf', '.pdf')).toContain('_file');
      expect(safeSuggestedName('COM1.txt', '.txt')).toContain('_file');
      expect(safeSuggestedName('LPT1.doc', '.doc')).toContain('_file');
    });

    test('handles empty filename', () => {
      const result = safeSuggestedName('.pdf', '.pdf');

      expect(result).toContain('unnamed_file');
    });

    test('handles leading dots', () => {
      const result = safeSuggestedName('...hidden.pdf', '.pdf');

      expect(result).not.toMatch(/^\./);
    });

    test('handles trailing dots', () => {
      const result = safeSuggestedName('file....pdf', '.pdf');

      expect(result).toContain('.pdf');
    });

    test('collapses multiple underscores', () => {
      const result = safeSuggestedName('file___with___many.pdf', '.pdf');

      expect(result).not.toContain('___');
    });

    test('truncates long filenames', () => {
      const longName = 'a'.repeat(300) + '.pdf';
      const result = safeSuggestedName(longName, '.pdf');

      expect(result.length).toBeLessThanOrEqual(204); // 200 + extension
    });

    test('preserves extension', () => {
      const result = safeSuggestedName('file.pdf', '.pdf');

      expect(result.endsWith('.pdf')).toBe(true);
    });

    test('handles special characters', () => {
      const result = safeSuggestedName('file|with?stars*.pdf', '.pdf');

      expect(result).not.toContain('|');
      expect(result).not.toContain('?');
      expect(result).not.toContain('*');
    });

    test('handles control characters', () => {
      const result = safeSuggestedName('file\u0000\u0001.pdf', '.pdf');

      expect(result).not.toContain('\u0000');
      expect(result).not.toContain('\u0001');
    });

    test('handles quotes and slashes', () => {
      const result = safeSuggestedName('file"with/slashes\\.pdf', '.pdf');

      expect(result).not.toContain('"');
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
    });
  });
});
