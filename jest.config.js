export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // ts-jest 仅负责把测试与源码转译为 Jest(CJS) 可执行的产物，类型检查由
        // tsconfig.*.json（NodeNext）承担。这里用内联 compilerOptions 提供转译参数，
        // 避免 ts-jest 读取一个 module: CommonJS 的 tsconfig —— TS 6 下 CommonJS 必然
        // 落到已废弃的 node10 解析（需 ignoreDeprecations），会污染 IDE 诊断。
        // 模块路径解析由下方 moduleNameMapper 负责，故此处无需 paths。
        diagnostics: false,
        tsconfig: {
          target: 'ES2020',
          module: 'CommonJS',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          isolatedModules: true,
          verbatimModuleSyntax: false,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/types/**',
    '!src/core/**/index.ts',
    '!src/extras/**/index.ts',
    '!src/plugins/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 98,
      lines: 98,
      statements: 98,
    },
    './src/core/**': {
      // 注：jest 对 glob 阈值按单文件执行；85 覆盖目前最低文件（SubscriptionManager 87.5%）
      branches: 85,
      functions: 98,
      lines: 98,
      statements: 98,
    },
    // 快照 / 选择器 / Action 增强随「core → extras」物理迁移一并沿用同一档分支门槛
    './src/extras/snapshot/**': { branches: 85, functions: 98, lines: 98, statements: 98 },
    './src/extras/selector/**': { branches: 85, functions: 98, lines: 98, statements: 98 },
    './src/extras/action/**': { branches: 85, functions: 98, lines: 98, statements: 98 },
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json'],
  // 源码与测试统一使用 ESM 规范写法（相对导入带 .js 扩展名），
  // 而 Jest 运行时由 ts-jest 以 CJS 加载 .ts，需把 .js 后缀映射回无后缀后再解析。
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)\\.js$': '<rootDir>/src/$1',
    '^@tests/(.*)\\.js$': '<rootDir>/tests/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  verbose: false,
}
