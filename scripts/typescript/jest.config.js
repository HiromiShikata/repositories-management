// jest.config.mjs
import { defaults } from 'jest-config';

/** @type {import('jest').Config} */
const config = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@octokit)/)'],
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'mts', 'cts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  preset: 'ts-jest/presets/default-esm',
};

export default config;
