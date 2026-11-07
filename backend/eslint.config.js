import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // tsconfig has noImplicitAny off and the code uses `any` deliberately (e.g. catch (e: any)).
      '@typescript-eslint/no-explicit-any': 'off',
      // Best-effort cleanup (kill, unlink, pool.end) ignores its errors on purpose.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A leading underscore marks a name as intentionally unused; rest siblings omit fields.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
);
