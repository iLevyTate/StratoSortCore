import reducer, {
  setSmartFolders,
  fetchSmartFolders
} from '../src/renderer/store/slices/filesSlice';

describe('filesSlice smartFolders', () => {
  test('setSmartFolders updates state', () => {
    const initial = reducer(undefined, { type: '@@INIT' });
    const next = reducer(initial, setSmartFolders([{ id: '1', name: 'Docs' }]));
    expect(next.smartFolders.length).toBe(1);
    expect(next.smartFolders[0].name).toBe('Docs');
  });

  test('fetchSmartFolders pending/fulfilled toggles loading', () => {
    const pendingState = reducer(undefined, { type: fetchSmartFolders.pending.type });
    expect(pendingState.smartFoldersLoading).toBe(true);
    const fulfilled = reducer(pendingState, {
      type: fetchSmartFolders.fulfilled.type,
      payload: [{ id: 'x' }]
    });
    expect(fulfilled.smartFoldersLoading).toBe(false);
    expect(fulfilled.smartFolders[0].id).toBe('x');
  });
});
