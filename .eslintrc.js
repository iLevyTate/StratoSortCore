module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:jest/recommended',
  ],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['react', 'jest', 'react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react/react-in-jsx-scope': 'off',
    // TD-9: Warn on console usage (except in logger.js itself)
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // INC-6: Prefer template literals over string concatenation
    'prefer-template': 'warn',
    // INC-7: Require default parameter values instead of manual defaults
    'prefer-rest-params': 'warn',
    // Prevent duplicate imports from same module
    'no-duplicate-imports': 'error',
    // Ensure consistent returns in functions
    'consistent-return': 'warn',
    // Prevent unused expressions
    'no-unused-expressions': [
      'error',
      { allowShortCircuit: true, allowTernary: true },
    ],
    // Warn on TODO/FIXME comments to track tech debt
    'no-warning-comments': [
      'warn',
      { terms: ['fixme', 'xxx', 'hack'], location: 'start' },
    ],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  overrides: [
    {
      // Enforce CommonJS in main process files
      files: ['src/main/**/*.js'],
      parserOptions: {
        sourceType: 'script',
      },
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ImportDeclaration',
            message:
              'Use require() instead of ES6 imports in main process files.',
          },
          {
            selector: 'ExportNamedDeclaration',
            message:
              'Use module.exports instead of ES6 exports in main process files.',
          },
          {
            selector: 'ExportDefaultDeclaration',
            message:
              'Use module.exports instead of ES6 exports in main process files.',
          },
        ],
      },
    },
    {
      // Enforce CommonJS in renderer utility files (non-React)
      files: ['src/renderer/utils/**/*.js'],
      parserOptions: {
        sourceType: 'script',
      },
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ImportDeclaration',
            message: 'Use require() instead of ES6 imports in utility files.',
          },
          {
            selector: 'ExportNamedDeclaration',
            message:
              'Use module.exports instead of ES6 exports in utility files.',
          },
          {
            selector: 'ExportDefaultDeclaration',
            message:
              'Use module.exports instead of ES6 exports in utility files.',
          },
        ],
      },
    },
    {
      // Enforce CommonJS in shared utility files
      files: ['src/shared/**/*.js'],
      parserOptions: {
        sourceType: 'script',
      },
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ImportDeclaration',
            message: 'Use require() instead of ES6 imports in shared files.',
          },
          {
            selector: 'ExportNamedDeclaration',
            message:
              'Use module.exports instead of ES6 exports in shared files.',
          },
          {
            selector: 'ExportDefaultDeclaration',
            message:
              'Use module.exports instead of ES6 exports in shared files.',
          },
        ],
      },
    },
    {
      // Relax certain strict rules for test files while keeping signal
      files: ['test/**/*.js'],
      rules: {
        'jest/no-conditional-expect': 'warn',
        'jest/no-standalone-expect': 'warn',
        'react/prop-types': 'off',
      },
    },
  ],
};
