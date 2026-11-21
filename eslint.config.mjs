import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', '*.mjs', 'test/integration/'] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // With noUncheckedIndexedAccess every array read is `T | undefined`; the
      // bounds-checked loops of the diff and the resolver assert with `!`.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // src/core is plain Node: everything that talks to the editor lives in src/vscode.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['vscode'] }],
    },
  },
)
