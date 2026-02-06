/**
 * @jest-environment node
 */
const {
  getFileEmbeddingId,
  getChunkEmbeddingId,
  getPathVariants,
  getAllIdVariants,
  buildPathUpdatePairs,
  extractPathFromId,
  getTypeFromId,
  idMatchesPath,
  FileIdPrefix
} = require('../src/main/utils/fileIdUtils');

jest.mock('../src/shared/pathSanitization', () => ({
  normalizePathForIndex: jest.fn((p) => p.toLowerCase().replace(/\\/g, '/'))
}));

describe('File ID Utils', () => {
  const filePath = 'C:\\Users\\Test\\Doc.pdf';
  const normalizedPath = 'c:/users/test/doc.pdf';

  test('getFileEmbeddingId generates correct ID', () => {
    expect(getFileEmbeddingId(filePath)).toBe(`file:${normalizedPath}`);
    expect(getFileEmbeddingId(filePath, 'image')).toBe(`image:${normalizedPath}`);
    expect(getFileEmbeddingId(filePath, 'chunk')).toBe(`chunk:${normalizedPath}`);
  });

  test('getChunkEmbeddingId generates correct ID', () => {
    expect(getChunkEmbeddingId(filePath, 5)).toBe(`chunk:${normalizedPath}:5`);
  });

  test('getPathVariants generates variants', () => {
    const variants = getPathVariants(filePath);
    expect(variants).toContain(normalizedPath);
    expect(variants).toContain(filePath);
    expect(variants.length).toBeGreaterThanOrEqual(2);
  });

  test('getAllIdVariants generates all ID types', () => {
    const ids = getAllIdVariants(filePath, { includeImages: true, includeChunks: true });
    expect(ids).toContain(`file:${normalizedPath}`);
    expect(ids).toContain(`image:${normalizedPath}`);
    expect(ids).toContain(`chunk:${normalizedPath}`);
  });

  test('buildPathUpdatePairs generates updates', () => {
    const newPath = 'D:\\New\\Doc.pdf';
    const updates = buildPathUpdatePairs(filePath, newPath);

    expect(updates.length).toBeGreaterThan(0);
    const update = updates.find((u) => u.oldId === `file:${normalizedPath}`);
    expect(update).toBeDefined();
    expect(update.newId).toBe(`file:${newPath.toLowerCase().replace(/\\/g, '/')}`);
    expect(update.newMeta.path).toBe(newPath);
  });

  test('extractPathFromId extracts path', () => {
    expect(extractPathFromId(`file:${normalizedPath}`)).toBe(normalizedPath);
    expect(extractPathFromId(`image:${normalizedPath}`)).toBe(normalizedPath);
    expect(extractPathFromId('invalid')).toBeNull();
  });

  test('getTypeFromId extracts type', () => {
    expect(getTypeFromId(`file:${normalizedPath}`)).toBe('file');
    expect(getTypeFromId(`image:${normalizedPath}`)).toBe('image');
    expect(getTypeFromId(`chunk:${normalizedPath}:0`)).toBe('chunk');
    expect(getTypeFromId('invalid')).toBeNull();
  });

  test('idMatchesPath matches correctly', () => {
    expect(idMatchesPath(`file:${normalizedPath}`, filePath)).toBe(true);
    expect(idMatchesPath(`file:${normalizedPath}`, 'C:\\Other.pdf')).toBe(false);
  });
});
