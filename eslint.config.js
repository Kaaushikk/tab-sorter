import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'artifacts/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' } } },
);
