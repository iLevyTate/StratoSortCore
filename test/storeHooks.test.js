/**
 * Tests for Redux Store Hooks
 * Tests typed Redux hooks for use in components
 */

describe('store hooks', () => {
  let useAppDispatch;
  let useAppSelector;

  beforeEach(() => {
    jest.resetModules();

    // Mock react-redux
    jest.mock('react-redux', () => ({
      useDispatch: jest.fn(() => jest.fn()),
      useSelector: jest.fn((selector) => selector({ test: 'state' }))
    }));

    const module = require('../src/renderer/store/hooks');
    useAppDispatch = module.useAppDispatch;
    useAppSelector = module.useAppSelector;
  });

  afterEach(() => {
    jest.unmock('react-redux');
  });

  describe('useAppDispatch', () => {
    test('is exported', () => {
      expect(useAppDispatch).toBeDefined();
    });

    test('is a function', () => {
      expect(typeof useAppDispatch).toBe('function');
    });
  });

  describe('useAppSelector', () => {
    test('is exported', () => {
      expect(useAppSelector).toBeDefined();
    });

    test('is a function', () => {
      expect(typeof useAppSelector).toBe('function');
    });
  });
});
