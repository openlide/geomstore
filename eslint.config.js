import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  // 基础 JavaScript 推荐规则
  js.configs.recommended,

  // TypeScript 文件配置
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        performance: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        Proxy: 'readonly',
        Reflect: 'readonly',
        Symbol: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript 推荐规则
      ...tseslint.configs.recommended.rules,

      // 自定义规则
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-inferrable-types': 'off',
      // ESM-only 仓库：禁止 `require()` / `module.exports` 等 CommonJS 写法
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-this-alias': 'off',

      // 关闭 JS 规则，使用 TS 规则替代
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',  // 使用 TypeScript 的函数重载

      // 通用规则
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-extra-semi': 'error',
      eqeqeq: ['error', 'always'],
      'no-duplicate-imports': ['error', { includeExports: false }],
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },

  // 测试文件配置
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        xit: 'readonly',
        xdescribe: 'readonly',
        fit: 'readonly',
        fdescribe: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      'no-empty': 'off',
    },
  },

  // 测试 setup 文件配置（注入小程序全局对象，需写 globalThis）
  {
    files: ['tests/setup.ts'],
    rules: {
      'no-undef': 'off',
      'no-global-assign': 'off',
    },
  },

  // 示例文件配置
  {
    files: ['examples/**/*.ts', 'src/**/*.example.ts', 'src/**/*.example/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-console': 'off',
    },
  },

  // 忽略文件
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'scripts/**',
      'jest.config.js',
    ],
  },
]
