import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

// Next.js 16 ships native flat ESLint configs, so we consume them directly
// (FlatCompat + eslint-config-next has a circular-structure bug on ESLint 9).
const eslintConfig = [
  ...next,
  ...nextTs,
  prettier,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'supabase/functions/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default eslintConfig;
