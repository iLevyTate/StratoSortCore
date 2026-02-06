const {
  withCorrelationId,
  getCorrelationId,
  generateCorrelationId
} = require('../src/shared/correlationId');

describe('correlationId', () => {
  test('generateCorrelationId returns prefix and id', () => {
    const id = generateCorrelationId('req');
    expect(id).toMatch(/^req_/);
  });

  test('withCorrelationId sets context for duration', () => {
    const result = withCorrelationId(() => getCorrelationId(), 'fixed-id');
    expect(result).toBe('fixed-id');
  });
});
