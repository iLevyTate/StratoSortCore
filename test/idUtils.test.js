jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.from('a1b2c3d4e5f6', 'hex'))
}));

const { generateSecureId } = require('../src/main/services/autoOrganize/idUtils');

describe('idUtils', () => {
  test('generateSecureId uses prefix and random bytes', () => {
    const id = generateSecureId('batch');
    expect(id).toMatch(/^batch-\d+-a1b2c3d4e5f6$/);
  });
});
