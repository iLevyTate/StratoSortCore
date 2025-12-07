/**
 * @jest-environment node
 */

const { resetFiles } = require('../src/main/services/chromadb/fileOperations');
const {
  resetFolders,
} = require('../src/main/services/chromadb/folderOperations');

describe('Chroma reset preserves hnsw:space metric key', () => {
  test('resetFiles uses hnsw:space', async () => {
    const createdCollections = [];
    const mockClient = {
      deleteCollection: jest.fn().mockResolvedValue(),
      createCollection: jest.fn().mockImplementation(async (opts) => {
        createdCollections.push(opts);
        return { name: opts.name };
      }),
    };

    await resetFiles({ client: mockClient });

    expect(createdCollections).toHaveLength(1);
    expect(createdCollections[0].metadata).toMatchObject({
      'hnsw:space': 'cosine',
    });
  });

  test('resetFolders uses hnsw:space', async () => {
    const createdCollections = [];
    const mockClient = {
      deleteCollection: jest.fn().mockResolvedValue(),
      createCollection: jest.fn().mockImplementation(async (opts) => {
        createdCollections.push(opts);
        return { name: opts.name };
      }),
    };

    await resetFolders({ client: mockClient });

    expect(createdCollections).toHaveLength(1);
    expect(createdCollections[0].metadata).toMatchObject({
      'hnsw:space': 'cosine',
    });
  });
});
