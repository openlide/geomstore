import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  // 基础 JavaScript 推荐规则
  js.configs.recommended,

  // TypeScript 文件配置
  {
    files: ['**/*.ts'],
    // 此处刻意不维护 languageOptions.globals：下方已对全部 TS 文件关闭 no-undef，
    // 而 flat config 里 globals 只被 no-undef 一类规则消费（`npx eslint --print-config
    // src/index.ts` 实测 no-undef = off），手写清单既不参与任何判定，又要在每次
    // Node/Jest 升级后手工同步。环境标识符的类型来源是 tsconfig 的 lib + @types。
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
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
    // globals 同样不维护（理由见上方 `**/*.ts` 块）：jest/describe/it 由 @types/jest
    // 经 tsconfig 的 types 提供，供 tsc 使用；no-undef 已关闭，ESLint 侧不需要声明。
    //
    // no-unused-vars 与 no-empty 一律沿用上方 `**/*.ts` 块的设置，测试文件不再例外关闭：
    // 测试里的无用变量/空 catch 同样是死代码与吞异常，`^_` 前缀足以表达「刻意不用」，
    // 整条规则关闭会让新增的死代码在 100+ 个测试文件里永久静默。
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-namespace': 'off',
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
