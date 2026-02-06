/**
 * Jest configuration for StratoSort tests (unit + integration).
 * Updated to Jest 29 syntax—removed deprecated options that triggered warnings.
 */

module.exports = {
  displayName: 'Stratosort Tests',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.+(js|ts|tsx)', '**/*.(test|spec).+(js|ts|tsx)'],
  // Exclude specialized test directories (they have their own configs)
  testPathIgnorePatterns: ['/node_modules/', '/stress/', '/performance/', '/e2e/', '/manual/'],
  // Allow transforming ESM modules in node_modules (required for @orama)
  transformIgnorePatterns: [
    'node_modules/(?!(@orama|@orama/plugin-data-persistence|lz4-napi|p-queue|p-timeout|eventemitter3)/)'
  ],
  // FIX: Force exit to prevent hanging on open handles from HTTP agents/intervals
  // The afterAll cleanup in test-setup.js handles most cases, but this is a safety net
  forceExit: true,
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-react',
          '@babel/preset-typescript'
        ]
      }
    ]
  },
  // No transforms needed for plain JS
  collectCoverageFrom: ['../src/**/*.js', '!../src/**/node_modules/**'],
  coverageDirectory: '../coverage',
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
  // Sequential execution keeps AI mocks deterministic
  maxWorkers: 1,

  moduleNameMapper: {
    // CSS and style mocks
    '\\.(css|less|scss|sass)$': '<rootDir>/mocks/styleMock.js',
    '^electron$': '<rootDir>/mocks/electron.js',
    '^officeparser$': '<rootDir>/mocks/officeparser.js',
    '^tesseract\\.js$': '<rootDir>/mocks/tesseract.js',
    '^sharp$': '<rootDir>/mocks/sharp.js',
    '^node-llama-cpp$': '<rootDir>/mocks/node-llama-cpp.js',
    '^xlsx-populate$': '<rootDir>/mocks/xlsx.js',
    '^fast-xml-parser$': '<rootDir>/mocks/fast-xml-parser.js',
    '^sanitize-html$': '<rootDir>/mocks/sanitize-html.js',
    '^music-metadata$': '<rootDir>/mocks/music-metadata.js',
    // p-queue v9 is ESM-only; map to CJS mock to avoid "Cannot use import statement" errors
    '^p-queue$': '<rootDir>/mocks/p-queue.js',
    // Redirect refactored service paths to new locations
    '(.*)services/AnalysisHistoryService$': '$1services/analysisHistory',
    '(.*)services/AutoOrganizeService$': '$1services/autoOrganize',
    '(.*)services/OrganizationSuggestionService$': '$1services/organization',
    '(.*)services/StartupManager$': '$1services/startup',
    '(.*)analysis/EmbeddingQueue$': '$1analysis/embeddingQueue',
    '(.*)shared/config$': '$1shared/config',
    '(.*)shared/utils$': '$1shared/edgeCaseUtils'
  },

  // Global setup for DOM-dependent packages
  setupFiles: ['<rootDir>/test-globals.js'],

  // Coverage thresholds to ensure quality standards
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  }
};
