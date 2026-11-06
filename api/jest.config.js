/** Unit tests only: pure logic (geo, fusion, payouts). No network, no database. */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // 151002: ts-jest's notice about node16 module kind; harmless for CommonJS tests.
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151002] } }],
  },
};
