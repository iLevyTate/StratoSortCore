/**
 * Jest configuration for StratoSort tests (unit + integration).
 * Updated to Jest 29 syntax—removed deprecated options that triggered warnings.
 */

module.exports = {
  displayName: 'Stratosort Tests',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  testMatch: [
    '**/__tests__/**/*.+(js|ts|tsx)',
    '**/*.(test|spec).+(js|ts|tsx)',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-react',
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  // No transforms needed for plain JS
  collectCoverageFrom: ['../src/**/*.js', '!../src/**/node_modules/**'],
  coverageDirectory: '../coverage',
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
  // Sequential execution keeps Ollama mocks deterministic
  maxWorkers: 1,

  moduleNameMapper: {
    '^electron$': '<rootDir>/mocks/electron.js',
    '^ollama$': '<rootDir>/mocks/ollama.js',
    '^officeparser$': '<rootDir>/mocks/officeparser.js',
    '^node-tesseract-ocr$': '<rootDir>/mocks/tesseract.js',
    '^sharp$': '<rootDir>/mocks/sharp.js',
    '^xlsx-populate$': '<rootDir>/mocks/xlsx.js',
    '^sanitize-html$': '<rootDir>/mocks/sanitize-html.js',
    '^music-metadata$': '<rootDir>/mocks/music-metadata.js',
  },

  // Global setup for DOM-dependent packages
  setupFiles: ['<rootDir>/test-globals.js'],
};
