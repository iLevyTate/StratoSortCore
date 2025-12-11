/**
 * @jest-environment node
 */

const path = require('path');

const { processBatchResults } = require('../src/main/services/autoOrganize/batchProcessor');

describe('autoOrganize batchProcessor edge cases', () => {
  test('uses path-based lookup when filenames collide', async () => {
    const files = [
      { name: 'dup.txt', path: '/a/dup.txt' },
      { name: 'dup.txt', path: '/b/dup.txt' }
    ];

    const batchSuggestions = {
      groups: [
        {
          confidence: 0.9,
          files: [
            {
              name: 'dup.txt',
              path: '/a/dup.txt',
              suggestion: { folder: 'FolderA', path: '/dest/A' }
            },
            {
              name: 'dup.txt',
              path: '/b/dup.txt',
              suggestion: { folder: 'FolderB', path: '/dest/B' }
            }
          ]
        }
      ]
    };

    const results = { organized: [], needsReview: [], operations: [] };

    await processBatchResults(
      batchSuggestions,
      files,
      {
        confidenceThreshold: 0.6,
        defaultLocation: '/dest',
        preserveNames: false
      },
      results,
      { recordFeedback: jest.fn().mockResolvedValue() },
      { requireReview: 0.4 }
    );

    expect(results.operations).toHaveLength(2);
    const destinations = results.operations.map((op) => op.destination);
    expect(destinations).toEqual(
      expect.arrayContaining([path.join('/dest/A', 'dup.txt'), path.join('/dest/B', 'dup.txt')])
    );
    const sources = results.operations.map((op) => op.source);
    expect(sources).toEqual(expect.arrayContaining(['/a/dup.txt', '/b/dup.txt']));
  });

  test('handles missing groups gracefully', async () => {
    const results = { organized: [], needsReview: [], operations: [] };
    await processBatchResults(
      { groups: null },
      [],
      {
        confidenceThreshold: 0.6,
        defaultLocation: '/dest',
        preserveNames: false
      },
      results,
      { recordFeedback: jest.fn().mockResolvedValue() },
      { requireReview: 0.4 }
    );
    expect(results.operations).toHaveLength(0);
    expect(results.organized).toHaveLength(0);
  });
});
