import globals from 'globals'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript strict + stylistic (recommended for typed codebases)
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global settings for all files
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow tagged template literals (LogTape logging syntax: log.info`message`)
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowTaggedTemplates: true },
      ],
      // Unused vars with underscore prefix are allowed
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Console is fine for server-side logging
      'no-console': 'off',
      // Prefer const when not reassigned
      'prefer-const': 'error',
      // No var declarations
      'no-var': 'error',
      // Allow non-null assertions (useful for test mocks)
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow any in strategic places (ImageMagick bindings)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty functions (often used as no-op defaults)
      '@typescript-eslint/no-empty-function': 'off',
      // Disable floating promises warning (many fire-and-forget patterns)
      '@typescript-eslint/no-floating-promises': 'off',
      // Disable misused promises warning (callback patterns in gm/puppeteer)
      '@typescript-eslint/no-misused-promises': 'off',
      // Allow require for dynamic imports in ImageMagick
      '@typescript-eslint/no-require-imports': 'off',
      // Disable nullish coalescing preference (too noisy for existing codebase)
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Allow inferrable types (cleaner code)
      '@typescript-eslint/no-inferrable-types': 'off',
      // Restrict template expressions (allow string | number | boolean)
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
      // Allow defensive optional chaining/conditions
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Allow arrow functions that return void (common in callbacks)
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // Allow async functions without await (useful for interface compliance)
      '@typescript-eslint/require-await': 'off',
      // Allow awaiting non-promises (tests do this for consistency)
      '@typescript-eslint/await-thenable': 'off',
      // Allow .match() instead of .exec() (more readable)
      '@typescript-eslint/prefer-regexp-exec': 'off',
      // Allow unnecessary type assertions (sometimes useful for documentation)
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Allow boolean comparisons like === true (explicit is fine)
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      // Allow overload signatures that could be combined (clarity over conciseness)
      '@typescript-eslint/unified-signatures': 'off',
      // Relax unsafe-any rules for lib files (gm/puppeteer interop)
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
    },
  },

  // Screenshot file needs browser globals for page.evaluate()
  {
    files: ['screenshot.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Browser context types file uses DOM types
  {
    files: ['types/browser-context.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Frontend files need browser globals and relaxed any rules (DOM operations)
  {
    files: ['html/js/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Frontend uses fetch/DOM which returns any
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Test files get additional globals
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Tests often use type assertions for mocks
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Tests use any for flexibility with mocks
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Ignored paths
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
      'tests/fixtures/**',
      'output/**',
      '*.js', // Ignore any remaining JS files
    ],
  }
)
