# Tron

<img src="./packages/snap/images/icon.svg" width="200" style="display: block; margin: 0 auto;" alt="Tron Logo" />

## Getting Started

The Tron Snap allows MetaMask and dapps to support all Tron-related networks and address types.

- [@metamask/tron-wallet-snap](packages/snap/README.md)
- [@metamask/tron-wallet-test-dapp](packages/site/README.md)

### Prerequisites

- [MetaMask Flask](https://metamask.io/flask/)
- Nodejs `22`. We **strongly** recommend you install via [NVM](https://github.com/nvm-sh/nvm) to avoid incompatibility issues between different node projects.
- Once installed, you should also install [Yarn](http://yarnpkg.com/) with `npm i -g yarn` to make working with this repository easiest.

## Installing

```bash
nvm use
yarn install
```

## Configuration

Please see `./src/packages/.env.example` for reference

## Running

### Quick Start

```bash
yarn start
```

- Snap server and debug page: http://localhost:8080/
- Example UI dapp: http://localhost:3000/

### Snap

⚠️ When snap updates you will need to still reconnect from the dapp to see changes

```bash
# Running Snap via watch mode
yarn workspace @metamask/tron-wallet-snap start
```
