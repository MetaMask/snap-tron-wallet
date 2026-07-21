# Agent Instructions

## Project Structure

This project is a **monorepo** consisting of two packages:

- **`packages/snap`** — The Tron Wallet Snap. Handles all Tron-specific blockchain logic: account derivation, transaction signing, fee calculation, staking, etc.
- **`packages/site`** — A test dapp for development and testing. Provides a UI to interact with the Snap's functionality.

## Snaps Technology

### What is a Snap?

A **Snap** is a plugin for MetaMask created by Consensys. This Tron Wallet Snap is prebuilt into MetaMask. Snaps compartmentalize logic and communicate with the extension through specific SDKs:

- **Keyring API** (`@metamask/keyring-api`) — For account management operations
- **Snaps SDK** (`@metamask/snaps-sdk`) — For general Snap functionality and UI components

### Execution Environment

Snaps are untrusted JavaScript programs that execute in a sandboxed environment running [Secure ECMAScript (SES)](https://github.com/endojs/endo/tree/master/packages/ses). This environment is **heavily restricted** compared to normal JavaScript.

**What's NOT Available:**
- **No DOM** — No `document`, `window`, or browser APIs
- **No Node.js built-ins** — No `fs`, `path`, `crypto` (unless polyfilled), `process`, etc.
- **No unrestricted network access** — `fetch` requires the `endowment:network-access` permission
- **No platform-specific APIs** — Environment is designed to be fully virtualizable

**Available Globals:**
- **`snap`** — The Snaps API global for making requests to MetaMask
- **`ethereum`** — EIP-1193 provider (requires `endowment:ethereum-provider` permission)
- **Standard JS globals** — `Promise`, `Error`, `Math`, `Set`, `Reflect`, `Map`, `Array`, etc.
- **`console`** — For logging
- **`fetch`** — Only with `endowment:network-access` permission
- **`setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`**
- **`SubtleCrypto`** — Web Crypto API
- **`TextEncoder` / `TextDecoder`**
- **`atob` / `btoa`** — Base64 encoding/decoding
- **`URL`**
- **`WebAssembly`** — Only with `endowment:webassembly` permission

**SES Restrictions:**

SES (Secure ECMAScript) is a hardened JavaScript subset that:
- Prevents Snaps from polluting the global environment
- Prevents access to sensitive APIs without explicit permission
- Isolates Snap code from other parts of the application
- Is more restrictive than JavaScript strict mode

To use Node.js built-in modules like `crypto` and `path`, set `polyfills: true` in the Snap config.

### Snaps APIs

#### `snap` Global (Snaps API)

The `snap` global provides the `snap.request()` method to call [Snaps API methods](https://docs.metamask.io/snaps/reference/snaps-api/). Each method requires permission in `snap.manifest.json`:

```json
"initialPermissions": {
  "snap_notify": {}
}
```

```typescript
await snap.request({
  method: "snap_notify",
  params: { type: "inApp", message: "Hello, world!" },
});
```

#### `ethereum` Global (Wallet API)

Snaps can call Wallet JSON-RPC methods using the `ethereum` global (requires `endowment:ethereum-provider` permission). **Important:** The `ethereum` global in Snaps is read-only—it cannot write to the blockchain or initiate transactions.

**Blocked methods** (cannot be called from Snaps):
- `wallet_requestPermissions`, `wallet_revokePermissions`
- `wallet_addEthereumChain`, `wallet_switchEthereumChain`
- `wallet_watchAsset`, `wallet_registerOnboarding`, `wallet_scanQRCode`
- `eth_sendTransaction`, `eth_decrypt`, `eth_getEncryptionPublicKey`

#### Custom JSON-RPC API

Snaps expose custom methods to dapps via the `onRpcRequest` entry point. This requires the `endowment:rpc` permission:

```json
"initialPermissions": {
  "endowment:rpc": { "dapps": true }
}
```

```typescript
export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case "hello":
      return "world!";
    default:
      throw new Error("Method not found.");
  }
};
```

Dapps call these methods using `wallet_invokeSnap` or `wallet_snap`.

## Git Hooks

- **pre-commit**: When snap files are staged, automatically runs `build:prod` and stages the production manifest. Always runs `lint:fix`.
- **pre-push**: Runs tests only.

The manifest (`snap.manifest.json`) should always be in production state in commits. Local development uses `yarn start` which applies local settings.

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

## Cursor Cloud specific instructions

Environment basics (Node 22 per `.nvmrc`, Yarn 4.17.0 per `packageManager`) are already
provisioned by the startup update script (`corepack enable` + `yarn install` + creating
`packages/snap/.env` from `.env.example` if missing). The notes below are non-obvious
gotchas for running things after the environment is up.

- **Build the snap before running tests.** `yarn test` uses `@metamask/snaps-jest`, which
  loads `packages/snap/dist/bundle.js`. If the snap is not built, every suite fails with
  `... does not exist ... Did you forget to build your snap?`. Run `yarn build:snap` (or
  `yarn build`) first. The pre-push hook runs `yarn test`, so build before pushing.
- **`packages/snap/.env` is required to build the snap.** Without it, `mm-snap build`
  fails SES bundle evaluation. The update script creates it from `.env.example`; if the
  file goes missing, `cp packages/snap/.env.example packages/snap/.env`.
- **`yarn start` mutates tracked files locally.** It rewrites `packages/snap/snap.manifest.json`
  (adds localhost origins + `endowment:rpc`) and `packages/snap/locales/en.json`. These are
  local-dev settings; the husky pre-commit hook auto-converts the manifest back to production
  (`build:prod`). Do not commit the local manifest/locale mutations — `git checkout --` them
  if you are not committing snap changes.
- **Dev servers:** `yarn start` runs both packages in parallel — the snap watch server at
  http://localhost:8080 (serves `/snap.manifest.json` and `/dist/bundle.js`) and the Gatsby
  test dapp at http://localhost:3000. To run just one: `yarn workspace @metamask/tron-wallet-snap start`
  or `yarn workspace @metamask/tron-wallet-test-dapp start`.
- **Harmless Gatsby `sharp` error.** On dapp startup, `gatsby-plugin-manifest` logs a fatal-looking
  `Cannot find module '.../sharp-linux-x64.node'` error. This is only favicon generation and
  happens because LavaMoat (`enableScripts: false`) blocks native build scripts. The dev server
  still serves fine at :3000.
- **Full end-to-end needs MetaMask Flask.** The dapp's connect/create-account/sign flows require
  the MetaMask Flask browser extension, which cannot run in a headless VM. To exercise the snap's
  keyring flows programmatically (e.g. account creation / address derivation), use
  `@metamask/snaps-jest` `installSnap()` and mock the keyring bridge with
  `snap.mockJsonRpc({ method: 'snap_manageAccounts', result: null })` before calling
  `onKeyringRequest`.
- **Lint note:** run `yarn lint` from the repo root. If you ran the test suite first, the generated
  `packages/snap/coverage/` dir produces a few harmless "Unused eslint-disable directive" warnings
  (0 errors); they are not from source files. Prefer the root-level `yarn lint` / `yarn lint:eslint`
  over `yarn workspace @metamask/tron-wallet-snap run lint:eslint` — the latter can fail with
  `command not found: eslint` because eslint is a root-only devDependency not exposed to the
  workspace's own script bin path.
- **Port 8080 is shared with the extension.** The snap dev server (`yarn start` /
  `yarn workspace @metamask/tron-wallet-snap start`) listens on **port 8080**, the same port the
  sibling `metamask-extension` repo's `yarn start` webpack-dev-server uses. Only run one of the two
  at a time; otherwise `mm-snap watch` fails with `EADDRINUSE :::8080` (the dapp on :3000 is
  unaffected but is useless without the snap server).
- **`installSnap()` needs an in-sync manifest.** `@metamask/snaps-jest` `installSnap()` loads the
  on-disk `snap.manifest.json` + `dist/bundle.js` and validates the shasum. `yarn start` rewrites the
  manifest to local-dev state and can leave it out of sync, causing
  `Invalid Snap manifest: manifest shasum does not match computed shasum`. Run `yarn build:snap`
  (which recomputes the shasum) before running any installSnap-based test, and after stopping a
  `yarn start` session.

