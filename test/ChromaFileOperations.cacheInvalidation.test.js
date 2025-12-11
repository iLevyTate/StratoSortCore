/**
 * @jest-environment node
 */

const { updateFilePaths } = require('../src/main/services/chromadb/fileOperations');

describe('Chroma fileOperations cache invalidation', () => {
  test('invalidates both new and old IDs on path update', async () => {
    const mockFileCollection = {
      get: jest.fn().mockResolvedValue({
        ids: ['old-id'],
        embeddings: [[0.1, 0.2]],
        metadatas: [{ path: '/old/path', name: 'old' }],
        documents: ['/old/path']
      }),
      delete: jest.fn().mockResolvedValue(),
      upsert: jest.fn().mockResolvedValue()
    };

    const mockQueryCache = {
      invalidateForFile: jest.fn()
    };

    const updated = await updateFilePaths({
      pathUpdates: [
        {
          oldId: 'old-id',
          newId: 'new-id',
          newMeta: { path: '/new/path', name: 'new' }
        }
      ],
      fileCollection: mockFileCollection,
      queryCache: mockQueryCache
    });

    expect(updated).toBe(1);
    expect(mockFileCollection.delete).toHaveBeenCalledWith({ ids: ['old-id'] });
    expect(mockFileCollection.upsert).toHaveBeenCalledTimes(1);
    expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('new-id');
    expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('old-id');
  });
});
