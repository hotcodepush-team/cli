import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import * as tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: ['**/*.test.ts', '**/*.config.*', 'test/**'],
        },
      ],
      'import-x/order': ['error', { alphabetize: { order: 'asc' } }],
      'complexity': ['error', 10],
      'max-lines-per-function': [
        'error',
        { IIFEs: true, max: 40, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['error', 2],
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
  },
  {
    files: ['**/*.test.ts', 'test/**', 'e2e/**'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  {
    // A build script imports dist/, which exists only after tsc has run. Lint runs without it.
    files: ['scripts/**'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^\\.\\./dist/'] }],
    },
  },
);
