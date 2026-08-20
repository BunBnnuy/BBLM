'use strict';

const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'release/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-global-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-unexpected-multiline': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-await-in-loop': 'off',
      'no-console': 'off',
      'semi': ['error', 'always'],
      'eqeqeq': ['error', 'always'],
    },
  },
];
