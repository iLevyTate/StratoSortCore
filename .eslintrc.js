module.exports = {
  extends: 'erb',
  // Use default parser (likely babel-eslint) for JS files by default
  // parserOptions: ... (remove global override)
  rules: {
    // Global rules
    'import/no-extraneous-dependencies': 'off',
    'import/no-unresolved': ['error', { ignore: ['csv-parse/sync'] }],
    'react/react-in-jsx-scope': 'off',
    'no-shadow': 'off', // conflict with TS
    // Relax overly strict rules for practical code
    'no-restricted-syntax': 'off', // Allow for-of loops
    'no-await-in-loop': 'off', // Sometimes needed for sequential async
    'no-plusplus': 'off', // Common JS pattern
    'no-continue': 'off', // Valid loop control
    'no-underscore-dangle': 'off', // Common for private/internal
    'func-names': 'off', // Anonymous functions are fine
    'no-multi-assign': 'off', // Chained assignment is valid
    'promise/param-names': 'off', // Flexible param names
    'class-methods-use-this': 'off', // Not always needed
    'no-param-reassign': 'off', // Sometimes needed
    'consistent-return': 'off', // Flexible returns
    'no-use-before-define': 'off', // Hoisting is valid
    'prefer-destructuring': 'off', // Optional preference
    'no-else-return': 'off', // Explicit returns are fine
    'no-lonely-if': 'off', // Standalone if is readable
    'no-nested-ternary': 'off', // Can be readable
    'no-unneeded-ternary': 'off', // Sometimes clearer
    'prefer-template': 'off', // String concat is fine
    'object-shorthand': 'off', // Explicit is fine
    'arrow-body-style': 'off', // Flexible arrow style
    'no-return-assign': 'off', // Return assignment is fine
    'no-bitwise': 'off', // Bitwise is valid
    radix: 'off', // parseInt without radix is fine
    camelcase: 'off', // Flexible naming
    'lines-between-class-members': 'off', // Flexible spacing
    'import/order': 'off', // Flexible import order
    'import/prefer-default-export': 'off', // Named exports are fine
    'import/no-cycle': 'off', // Hard to avoid sometimes
    'max-classes-per-file': 'off', // Flexible class organization
    'no-new': 'off', // Constructor side effects are valid
    'valid-typeof': 'off', // Flexible typeof checks
    'global-require': 'off', // Dynamic requires are valid
    'import/no-dynamic-require': 'off', // Dynamic requires are valid
    'no-restricted-globals': 'off', // Allow isNaN etc
    'no-promise-executor-return': 'off', // Allow returns in promise
    'default-case': 'off', // Default case not always needed
    'no-loop-func': 'off', // Functions in loops are fine
    'no-useless-return': 'off', // Explicit returns are fine
    'no-empty-function': 'off', // Empty functions are valid
    'no-useless-constructor': 'off', // Explicit constructors are fine
    'prefer-exponentiation-operator': 'off', // Math.pow is fine
    'prefer-object-spread': 'off', // Object.assign is fine
    'no-prototype-builtins': 'off', // Direct prototype access is fine
    'prefer-promise-reject-errors': 'off', // Flexible reject
    'react/prop-types': 'off', // Not using PropTypes
    'react/jsx-props-no-spreading': 'off', // Spread props are fine
    'react/no-array-index-key': 'off', // Index keys are fine sometimes
    'react/jsx-boolean-value': 'off', // Explicit boolean is fine
    'react/button-has-type': 'off', // Default button type is fine
    'react/destructuring-assignment': 'off', // Flexible destructuring
    'react/jsx-no-useless-fragment': 'off', // Fragments are fine
    'react/no-unescaped-entities': 'off', // Entities in JSX are fine
    'react/jsx-curly-brace-presence': 'off', // Flexible curly braces
    'react/no-unused-prop-types': 'off', // TS handles this
    'react/require-default-props': 'off', // Not using defaultProps
    'react/function-component-definition': 'off', // Flexible component style
    'jsx-a11y/click-events-have-key-events': 'off', // Not always needed
    'jsx-a11y/no-static-element-interactions': 'off', // Valid pattern
    'jsx-a11y/anchor-is-valid': 'off', // Flexible anchor usage
    'jsx-a11y/no-noninteractive-element-interactions': 'off', // Valid pattern
    'jsx-a11y/label-has-associated-control': 'off', // Flexible labels
    'promise/catch-or-return': 'off', // Flexible promise handling
    'promise/always-return': 'off', // Flexible promise returns
    'promise/no-nesting': 'off', // Nested promises are fine
    'react/jsx-filename-extension': ['warn', { extensions: ['.js', '.jsx', '.ts', '.tsx'] }], // Allow JSX in .js
    'import/no-import-module-exports': 'off', // Mixed imports/exports are fine
    'import/extensions': 'off', // Flexible extensions
    'no-unused-expressions': 'off', // Expression statements are fine
    'no-console': 'off', // Console is fine in this app
    'react/forbid-prop-types': 'off', // Any prop types are fine
    'jsx-a11y/control-has-associated-label': 'off', // Not always needed
    'jsx-a11y/no-redundant-roles': 'off', // Explicit roles are fine
    'jsx-a11y/role-supports-aria-props': 'off', // Flexible aria
    'jsx-a11y/interactive-supports-focus': 'off', // Custom focus handling
    'react/jsx-no-constructed-context-values': 'off', // Will optimize if needed
    'no-void': 'off', // Void is valid
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], // Warn on unused, ignore _prefixed
    'no-return-await': 'off', // Explicit return await is fine
    'default-param-last': 'off', // Flexible param order
    'no-labels': 'off', // Labels are valid for nested loops
    'symbol-description': 'off', // Symbol description is optional
    'guard-for-in': 'off', // For-in is fine without guard
    'react/sort-comp': 'off', // Flexible method order
    'jsx-a11y/no-autofocus': 'off', // Autofocus is fine
    'jsx-a11y/no-noninteractive-tabindex': 'off', // Tabindex is fine
    'react-hooks/exhaustive-deps': 'off', // Manual dependency control
    'jsx-a11y/role-has-required-aria-props': 'off', // Flexible aria
    'no-sequences': 'off' // Comma operator is valid
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        createDefaultProgram: true
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'plugin:@typescript-eslint/recommended',
        'erb' // Re-apply erb rules on top if needed, or just let them cascade
      ],
      settings: {
        'import/resolver': {
          typescript: {}
        }
      },
      rules: {
        'no-undef': 'off', // TS handles this
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn'],
        '@typescript-eslint/no-shadow': 'warn',
        '@typescript-eslint/no-explicit-any': 'warn',
        'react/prop-types': 'off', // TS handles props
        'import/extensions': 'off', // TS handles extensions
        'no-restricted-syntax': 'off',
        'no-await-in-loop': 'off',
        'no-promise-executor-return': 'off'
      }
    },
    {
      files: [
        'test/**/*.js',
        'test/**/*.ts',
        '**/*.test.js',
        '**/*.test.ts',
        '**/*.spec.js',
        '**/*.spec.ts'
      ],
      rules: {
        'global-require': 'off',
        'no-restricted-syntax': 'off',
        'no-underscore-dangle': 'off',
        'no-plusplus': 'off',
        'no-promise-executor-return': 'off',
        'prefer-destructuring': 'off',
        'jest/expect-expect': 'off',
        'no-console': 'off',
        'import/no-dynamic-require': 'off',
        'class-methods-use-this': 'off',
        'no-await-in-loop': 'off',
        'react/prop-types': 'off',
        'jest/no-conditional-expect': 'off',
        'max-classes-per-file': 'off',
        'lines-between-class-members': 'off',
        'react/jsx-filename-extension': 'off',
        'import/order': 'off',
        'import/first': 'off',
        'import/newline-after-import': 'off',
        'no-unused-vars': 'off',
        'no-unused-expressions': 'off',
        'no-useless-return': 'off',
        'react/button-has-type': 'off',
        'react/jsx-boolean-value': 'off',
        'promise/param-names': 'off',
        'prefer-promise-reject-errors': 'off',
        'prefer-template': 'off',
        'dot-notation': 'off',
        'no-use-before-define': 'off',
        'prefer-const': 'off',
        'react/jsx-props-no-spreading': 'off',
        'react/no-array-index-key': 'off',
        'import/no-unresolved': 'off',
        'jest/no-jasmine-globals': 'off',
        'no-undef': 'off',
        'no-useless-constructor': 'off',
        'no-empty-function': 'off',
        'no-return-await': 'off',
        'no-loop-func': 'off',
        radix: 'off',
        'no-continue': 'off',
        'no-restricted-globals': 'off',
        'jest/no-standalone-expect': 'off',
        'no-unneeded-ternary': 'off',
        'no-else-return': 'off',
        'no-nested-ternary': 'off',
        'no-proto': 'off',
        'prefer-exponentiation-operator': 'off',
        'no-restricted-properties': 'off',
        'object-shorthand': 'off',
        'func-names': 'off',
        'no-bitwise': 'off',
        'promise/catch-or-return': 'off',
        'promise/always-return': 'off'
      }
    },
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
    {
      files: [
        '*.config.js',
        'tailwind.config.js',
        'webpack.*.js',
        'postcss.config.js',
        'babel.config.js'
      ],
      rules: {
        'global-require': 'off',
        'import/no-dynamic-require': 'off'
      }
    }
  ],
  settings: {
    'import/resolver': {
      node: {},
      webpack: {
        config: './webpack.config.js'
      }
    }
  }
};
