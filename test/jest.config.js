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
  // Sequential execution keeps Ollama mocks deterministic
  maxWorkers: 1,

  moduleNameMapper: {
    // CSS and style mocks
    '\\.(css|less|scss|sass)$': '<rootDir>/mocks/styleMock.js',
    '^electron$': '<rootDir>/mocks/electron.js',
    '^ollama$': '<rootDir>/mocks/ollama.js',
    '^officeparser$': '<rootDir>/mocks/officeparser.js',
    '^node-tesseract-ocr$': '<rootDir>/mocks/tesseract.js',
    '^sharp$': '<rootDir>/mocks/sharp.js',
    '^xlsx-populate$': '<rootDir>/mocks/xlsx.js',
    '^fast-xml-parser$': '<rootDir>/mocks/fast-xml-parser.js',
    '^sanitize-html$': '<rootDir>/mocks/sanitize-html.js',
    '^music-metadata$': '<rootDir>/mocks/music-metadata.js',
    // Redirect refactored service paths to new locations
    '(.*)services/ChromaDBService$': '$1services/chromadb',
    '(.*)services/AnalysisHistoryService$': '$1services/analysisHistory',
    '(.*)services/AutoOrganizeService$': '$1services/autoOrganize',
    '(.*)services/OrganizationSuggestionService$': '$1services/organization',
    '(.*)services/StartupManager$': '$1services/startup',
    '(.*)analysis/EmbeddingQueue$': '$1analysis/embeddingQueue',
    '(.*)shared/config$': '$1shared/config',
    '(.*)shared/utils$': '$1shared/edgeCaseUtils'
  },

  // Global setup for DOM-dependent packages
  setupFiles: ['<rootDir>/test-globals.js']
};
