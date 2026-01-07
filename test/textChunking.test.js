const { chunkText } = require('../src/main/utils/textChunking');

describe('chunkText', () => {
  test('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  test('chunks deterministically with overlap', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 200, maxChunks: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        index: 0,
        charStart: 0,
        charEnd: 1000
      })
    );
    // step = 800, so second chunk starts at 800
    expect(chunks[1].charStart).toBe(800);
    expect(chunks[1].charEnd).toBe(1800);
  });

  test('respects maxChunks cap', () => {
    const text = 'x'.repeat(50000);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 200, maxChunks: 3 });
    expect(chunks).toHaveLength(3);
    expect(chunks[2].index).toBe(2);
  });

  test('preserves offsets when trimming whitespace', () => {
    const text = '  Hello world  ';
    const [chunk] = chunkText(text, { chunkSize: 50, overlap: 0, maxChunks: 2 });

    expect(chunk.text).toBe('Hello world');
    expect(chunk.charStart).toBe(2);
    expect(chunk.charEnd).toBe(13); // exclusive end index after trimming
  });
});
