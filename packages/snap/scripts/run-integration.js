#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const MOCK_API_BASE_URL = 'http://127.0.0.1:8899';

const integrationBuildEnvironment = {
  ...process.env,
  ENVIRONMENT: 'test',
  RPC_URL_LIST_MAINNET: MOCK_API_BASE_URL,
  RPC_URL_LIST_NILE_TESTNET: MOCK_API_BASE_URL,
  RPC_URL_LIST_SHASTA_TESTNET: MOCK_API_BASE_URL,
  EXPLORER_MAINNET_BASE_URL: 'https://explorer-mainnet.test',
  EXPLORER_NILE_BASE_URL: 'https://explorer-nile.test',
  EXPLORER_SHASTA_BASE_URL: 'https://explorer-shasta.test',
  PRICE_API_BASE_URL: MOCK_API_BASE_URL,
  TOKEN_API_BASE_URL: MOCK_API_BASE_URL,
  STATIC_API_BASE_URL: 'https://static.test',
  SECURITY_ALERTS_API_BASE_URL: MOCK_API_BASE_URL,
  NFT_API_BASE_URL: MOCK_API_BASE_URL,
  LOCAL_API_BASE_URL: MOCK_API_BASE_URL,
  TRONGRID_BASE_URL_MAINNET: MOCK_API_BASE_URL,
  TRONGRID_BASE_URL_NILE: MOCK_API_BASE_URL,
  TRONGRID_BASE_URL_SHASTA: MOCK_API_BASE_URL,
  TRON_HTTP_BASE_URL_MAINNET: MOCK_API_BASE_URL,
  TRON_HTTP_BASE_URL_NILE: MOCK_API_BASE_URL,
  TRON_HTTP_BASE_URL_SHASTA: MOCK_API_BASE_URL,
};

const shellCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(shellCommand, ['build'], {
  env: integrationBuildEnvironment,
});

run(shellCommand, [
  'jest',
  '--runInBand',
  '--collectCoverage=false',
  '--testMatch=**/*.integration-test.tsx',
  '--passWithNoTests',
  ...process.argv.slice(2),
]);
