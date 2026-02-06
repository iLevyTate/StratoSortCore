const { GRAPH_FEATURE_FLAGS } = require('../src/shared/featureFlags');

describe('featureFlags', () => {
  test('GRAPH_FEATURE_FLAGS includes expected keys', () => {
    expect(GRAPH_FEATURE_FLAGS).toHaveProperty('SHOW_GRAPH');
    expect(GRAPH_FEATURE_FLAGS).toHaveProperty('GRAPH_MULTI_HOP');
  });
});
