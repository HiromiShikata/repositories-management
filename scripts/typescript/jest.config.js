module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts?$': ['@swc/jest'],
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
  collectCoverage: true,
  coverageDirectory: 'reports/coverage',
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'reports/jest-junit' }],
    [
      './node_modules/jest-html-reporter',
      { outputPath: 'reports/jest-html-reporter/index.html' },
    ],
  ],
  testPathIgnorePatterns: ['/node_modules/', '/bin/', '/dist/'],
};
