import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/src/**/*.spec.ts',
      ],
      testPathIgnorePatterns: [
        '\\.integration\\.spec\\.ts$',
        '\\.e2e-spec\\.ts$',
      ],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/src/**/*.integration.spec.ts',
      ],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
      setupFiles: ['<rootDir>/test/setup/setup-env.ts'],
    },
  ],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
};

export default config;
