module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  collectCoverage: true,
  coverageThreshold: { global: { lines: 90 } },
  moduleNameMapper: {
    '^@doudizhu/types$': '<rootDir>/../types/src/index.ts'
  }
};
