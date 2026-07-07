import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// ADR-0006: DOM-touching d3 packages are banned everywhere.
const d3DomBans = [
  'd3',
  'd3-selection',
  'd3-transition',
  'd3-zoom',
  'd3-drag',
  'd3-brush',
  'd3-axis',
].map((name) => ({
  name,
  message: `Banned by ADR-0006 (D3 math-only policy): ${name} touches the DOM.`,
}));

const noDeepImports = {
  group: ['@graphloom/*/*'],
  message: 'No cross-package deep imports — use the package public entry point.',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.nx/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        { paths: d3DomBans, patterns: [noDeepImports] },
      ],
    },
  },
  {
    // Framework-free zone: every package except the framework wrappers.
    files: ['packages/**'],
    ignores: ['packages/angular/**', 'packages/react/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: d3DomBans,
          patterns: [
            noDeepImports,
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@angular/*'],
              message:
                'Framework imports are banned in core packages — business logic never lives in wrappers, and core never depends on a framework.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
