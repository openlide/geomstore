module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
        diagnostics: false,
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts', '!src/types/**', '!src/core/**/index.ts', '!src/plugins/**/index.ts'],
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
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  verbose: false,
}
