import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', '*.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
