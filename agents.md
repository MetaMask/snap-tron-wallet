# Agent Instructions

## Project Structure

This project is a **monorepo** consisting of two main parts:

### 1. Snap (`packages/snap`)

A **Snap** is a type of plugin created by Consensys that can be loaded into the MetaMask extension. In this case, the Tron Wallet Snap is prebuilt into MetaMask. Snaps compartmentalize logic and can be called by the extension through mediation of specific SDKs:

- **Keyring API** (`@metamask/keyring-api`) - For account management operations
- **Snaps SDK** (`@metamask/snaps-sdk`) - For general Snap functionality and UI components

The Snap handles all Tron blockchain logic: account derivation, transaction signing, fee calculation, staking, etc.

### 2. Test Dapp / Site (`packages/site`)

A test dapp (decentralized application) used for development and testing of the Snap. It provides a UI to interact with the Snap's functionality.

## Linting + Formatting

**After each code generation**, run the linter to fix formatting and style issues:
```bash
yarn lint:fix
```

## Running Tests

To run all tests:
```bash
yarn test
```

To run tests for a specific file:
```bash
yarn test -- "<file path>"
```

Example:
```bash
yarn test -- "packages/snap/src/services/send/FeeCalculatorService.test.ts"
```

## Test Naming Conventions

Test names should skip "should" and start directly with the verb.

**Good:**
- `it('returns empty array when no transactions exist', ...)`
- `it('throws error for invalid address', ...)`
- `it('calculates fee using feeLimit fallback when simulation fails', ...)`

**Bad:**
- `it('should return empty array when no transactions exist', ...)`
- `it('should throw error for invalid address', ...)`

