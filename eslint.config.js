const js = require('@eslint/js');
const globals = require('globals');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');
const importPlugin = require('eslint-plugin-import');
const promisePlugin = require('eslint-plugin-promise');
const jestPlugin = require('eslint-plugin-jest');

module.exports = [
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'node_modules/',
      'dist/',
      'release/',
      'coverage/',
      'assets/',
      'tmpUserData/',
      'release/build/',
      'Documents/',
      'test-results/',
      '**/*.min.js',
      '**/*.bundle.js',
      '**/*.map'
    ]
  },

  // Base configuration for all JS/JSX files
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      import: importPlugin,
      promise: promisePlugin
    },
    settings: {
      react: {
        version: 'detect'
      },
      'import/resolver': {
        node: {},
        webpack: {
          config: './webpack.config.js'
        }
      }
    },
    rules: {
      // Base ESLint recommended
      ...js.configs.recommended.rules,

      // Import rules
      'import/no-extraneous-dependencies': 'off',
      'import/no-unresolved': ['error', { ignore: ['csv-parse/sync'] }],
      'import/order': 'off',
      'import/prefer-default-export': 'off',
      'import/no-cycle': 'off',
      'import/no-import-module-exports': 'off',
      'import/extensions': 'off',
      'import/no-dynamic-require': 'off',

      // React rules
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/no-array-index-key': 'off',
      'react/jsx-boolean-value': 'off',
      'react/button-has-type': 'off',
      'react/destructuring-assignment': 'off',
      'react/jsx-no-useless-fragment': 'off',
      'react/no-unescaped-entities': 'off',
      'react/jsx-curly-brace-presence': 'off',
      'react/no-unused-prop-types': 'off',
      'react/require-default-props': 'off',
      'react/function-component-definition': 'off',
      'react/forbid-prop-types': 'off',
      'react/jsx-no-constructed-context-values': 'off',
      'react/sort-comp': 'off',
      'react/jsx-filename-extension': ['warn', { extensions: ['.js', '.jsx', '.ts', '.tsx'] }],

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // JSX A11y rules (relaxed)
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-redundant-roles': 'off',
      'jsx-a11y/role-supports-aria-props': 'off',
      'jsx-a11y/interactive-supports-focus': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      'jsx-a11y/role-has-required-aria-props': 'off',

      // Promise rules
      'promise/param-names': 'off',
      'promise/catch-or-return': 'off',
      'promise/always-return': 'off',
      'promise/no-nesting': 'off',

      // General JS rules (relaxed for practical code)
      'no-shadow': 'off',
      'no-restricted-syntax': 'off',
      'no-await-in-loop': 'off',
      'no-plusplus': 'off',
      'no-continue': 'off',
      'no-underscore-dangle': 'off',
      'func-names': 'off',
      'no-multi-assign': 'off',
      'class-methods-use-this': 'off',
      'no-param-reassign': 'off',
      'consistent-return': 'off',
      'no-use-before-define': 'off',
      'prefer-destructuring': 'off',
      'no-else-return': 'off',
      'no-lonely-if': 'off',
      'no-nested-ternary': 'off',
      'no-unneeded-ternary': 'off',
      'prefer-template': 'off',
      'object-shorthand': 'off',
      'arrow-body-style': 'off',
      'no-return-assign': 'off',
      'no-bitwise': 'off',
      radix: 'off',
      camelcase: 'off',
      'lines-between-class-members': 'off',
      'max-classes-per-file': 'off',
      'no-new': 'off',
      'valid-typeof': 'off',
      'global-require': 'off',
      'no-restricted-globals': 'off',
      'no-promise-executor-return': 'off',
      'default-case': 'off',
      'no-loop-func': 'off',
      'no-useless-return': 'off',
      'no-empty-function': 'off',
      'no-useless-constructor': 'off',
      'prefer-exponentiation-operator': 'off',
      'prefer-object-spread': 'off',
      'no-prototype-builtins': 'off',
      'prefer-promise-reject-errors': 'off',
      'no-void': 'off',
      'no-return-await': 'off',
      'default-param-last': 'off',
      'no-labels': 'off',
      'symbol-description': 'off',
      'guard-for-in': 'off',
      'no-sequences': 'off',
      'no-unused-expressions': 'off',

      // Console logging - warn by default, logger.js override below
      'no-console': 'warn',

      // Unused vars - warn but ignore _ prefixed
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },

  // TypeScript files configuration
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2020
      }
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      import: importPlugin,
      promise: promisePlugin
    },
    settings: {
      react: {
        version: 'detect'
      },
      'import/resolver': {
        typescript: {}
      }
    },
    rules: {
      // Base ESLint recommended
      ...js.configs.recommended.rules,

      // TypeScript specific
      ...typescriptPlugin.configs.recommended.rules,
      'no-undef': 'off', // TS handles this
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/no-shadow': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Import rules
      'import/no-extraneous-dependencies': 'off',
      'import/extensions': 'off',
      'import/order': 'off',
      'import/prefer-default-export': 'off',
      'import/no-cycle': 'off',
      'import/no-import-module-exports': 'off',
      'import/no-dynamic-require': 'off',

      // React rules
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/no-array-index-key': 'off',
      'react/jsx-boolean-value': 'off',
      'react/button-has-type': 'off',
      'react/destructuring-assignment': 'off',
      'react/jsx-no-useless-fragment': 'off',
      'react/no-unescaped-entities': 'off',
      'react/jsx-curly-brace-presence': 'off',
      'react/no-unused-prop-types': 'off',
      'react/require-default-props': 'off',
      'react/function-component-definition': 'off',
      'react/jsx-filename-extension': ['warn', { extensions: ['.js', '.jsx', '.ts', '.tsx'] }],

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // JSX A11y rules (relaxed)
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/label-has-associated-control': 'off',

      // Promise rules
      'promise/param-names': 'off',
      'promise/catch-or-return': 'off',
      'promise/always-return': 'off',
      'promise/no-nesting': 'off',

      // General rules (relaxed)
      'no-restricted-syntax': 'off',
      'no-await-in-loop': 'off',
      'no-promise-executor-return': 'off',
      'no-console': 'warn',
      'no-plusplus': 'off',
      'no-continue': 'off',
      'no-underscore-dangle': 'off',
      'func-names': 'off',
      'class-methods-use-this': 'off',
      'no-param-reassign': 'off',
      'consistent-return': 'off',
      'no-use-before-define': 'off',
      'prefer-destructuring': 'off',
      'no-else-return': 'off',
      'no-nested-ternary': 'off',
      'no-unneeded-ternary': 'off',
      'prefer-template': 'off',
      'object-shorthand': 'off',
      'arrow-body-style': 'off',
      'no-return-assign': 'off',
      'no-bitwise': 'off',
      radix: 'off',
      camelcase: 'off',
      'lines-between-class-members': 'off',
      'max-classes-per-file': 'off',
      'no-new': 'off',
      'global-require': 'off',
      'no-restricted-globals': 'off',
      'default-case': 'off',
      'no-loop-func': 'off',
      'no-useless-return': 'off',
      'no-empty-function': 'off',
      'no-useless-constructor': 'off',
      'prefer-exponentiation-operator': 'off',
      'prefer-object-spread': 'off',
      'no-prototype-builtins': 'off',
      'prefer-promise-reject-errors': 'off',
      'no-void': 'off',
      'no-return-await': 'off',
      'no-unused-expressions': 'off'
    }
  },

  // Logger files - allow console
  {
    files: ['**/logger.js', '**/logger.ts'],
    rules: {
      'no-console': 'off'
    }
  },

  // Test files configuration
  {
    files: ['test/**/*.{js,ts}', '**/*.test.{js,ts}', '**/*.spec.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.jest,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      jest: jestPlugin
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
      'no-unused-expressions': 'off',
      'no-undef': 'off',
      'global-require': 'off',
      'import/no-dynamic-require': 'off',
      'import/no-unresolved': 'off',
      'import/order': 'off',
      'import/first': 'off',
      'import/newline-after-import': 'off',
      'no-restricted-syntax': 'off',
      'no-underscore-dangle': 'off',
      'no-plusplus': 'off',
      'no-promise-executor-return': 'off',
      'prefer-destructuring': 'off',
      'class-methods-use-this': 'off',
      'no-await-in-loop': 'off',
      'max-classes-per-file': 'off',
      'lines-between-class-members': 'off',
      'no-useless-return': 'off',
      'no-useless-constructor': 'off',
      'no-empty-function': 'off',
      'no-return-await': 'off',
      'no-loop-func': 'off',
      radix: 'off',
      'no-continue': 'off',
      'no-restricted-globals': 'off',
      'no-unneeded-ternary': 'off',
      'no-else-return': 'off',
      'no-nested-ternary': 'off',
      'no-proto': 'off',
      'prefer-exponentiation-operator': 'off',
      'no-restricted-properties': 'off',
      'object-shorthand': 'off',
      'func-names': 'off',
      'no-bitwise': 'off',
      'no-use-before-define': 'off',
      'prefer-const': 'off',
      'prefer-template': 'off',
      'dot-notation': 'off',
      'react/prop-types': 'off',
      'react/jsx-filename-extension': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/no-array-index-key': 'off',
      'react/button-has-type': 'off',
      'react/jsx-boolean-value': 'off',
      'promise/param-names': 'off',
      'promise/catch-or-return': 'off',
      'promise/always-return': 'off',
      'prefer-promise-reject-errors': 'off',
      'jest/expect-expect': 'off',
      'jest/no-conditional-expect': 'off',
      'jest/no-jasmine-globals': 'off',
      'jest/no-standalone-expect': 'off'
    }
  },

  // Scripts directory configuration
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
      'global-require': 'off',
      'import/no-dynamic-require': 'off',
      'promise/catch-or-return': 'off',
      'promise/always-return': 'off',
      'promise/no-nesting': 'off'
    }
  },

  // Polyfills and shared files that may need to handle globalThis
  {
    files: ['**/polyfills.js', '**/correlationId.js'],
    rules: {
      'no-redeclare': 'off'
    }
  },

  // Config files configuration
  {
    files: [
      '*.config.js',
      'tailwind.config.js',
      'webpack.*.js',
      'postcss.config.js',
      'babel.config.js',
      'eslint.config.js'
    ],
    rules: {
      'global-require': 'off',
      'import/no-dynamic-require': 'off',
      'no-console': 'off'
    }
  }
];
