import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Correctness and security rules, not style (formatting is not linted). Type-aware rules run on
// server code, where an unhandled promise can drop an error or leave a request hanging.
export default tseslint.config(
  // infrastructure/ (the CDK app) is its own npm project with its own tsconfig and tests.
  { ignores: ['dist/**', 'node_modules/**', 'infrastructure/**', 'fixtures/**', 'docs/**', '.local/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mjs,mts}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      // Core rules kept from the Biome configuration the reference server used before.
      'no-template-curly-in-string': 'error',
      'default-case-last': 'error',
      'array-callback-return': 'error',
      'no-self-compare': 'error',
      radix: 'error',
      'no-constructor-return': 'error',
    },
  },

  // Server code: the stdio transport makes stdout the JSON-RPC stream, so only stderr logging is
  // allowed, and promises must be awaited or explicitly voided.
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },

  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } },

  // TEMPORARY: the v1 tool and client code types upstream payloads as `any` (about 300 uses).
  // They are replaced by typed payloads when the tools move to the v2 SDK and the instance-based
  // ApiClient (package B); remove this block then. See "Lint" in CLAUDE.md.
  {
    files: ['src/tools/**/*.ts', 'src/utils/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Tests and scripts may use any, and test doubles often stub with empty functions. Scripts and
  // test harnesses are command-line programs, so they may log to stdout.
  {
    files: ['src/**/*.test.ts', 'src/characterization/**/*.ts', 'src/**/__fixtures__/**/*.ts', 'scripts/**/*.{ts,mjs,mts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': 'off',
      // node:test registers top-level test() calls and returns a promise nobody awaits.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
