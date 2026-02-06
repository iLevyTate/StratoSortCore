jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  }
}));

jest.mock('../src/shared/atomicFile', () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(),
  loadJsonFile: jest.fn().mockResolvedValue({ model: 'embed', dimensions: 768 })
}));

const { atomicWriteFile, loadJsonFile } = require('../src/shared/atomicFile');
const {
  readEmbeddingIndexMetadata,
  writeEmbeddingIndexMetadata
} = require('../src/main/services/vectorDb/embeddingIndexMetadata');

describe('embeddingIndexMetadata', () => {
  test('readEmbeddingIndexMetadata loads metadata', async () => {
    const result = await readEmbeddingIndexMetadata();
    expect(result).toEqual({ model: 'embed', dimensions: 768 });
    expect(loadJsonFile).toHaveBeenCalled();
  });

  test('writeEmbeddingIndexMetadata writes metadata with updatedAt', async () => {
    await writeEmbeddingIndexMetadata({ model: 'embed', dimensions: 768 });
    expect(atomicWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('embedding-index.json'),
      expect.objectContaining({ model: 'embed', dimensions: 768, updatedAt: expect.any(String) }),
      { pretty: true }
    );
  });
});
