# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add "Ready for Withdrawal" TRX as a special asset to display unstaked TRX that has completed the withdrawal period and is ready to be claimed ([#208](https://github.com/MetaMask/snap-tron-wallet/pull/208))
- Add staking rewards TRX asset to display unclaimed voting rewards ([#209](https://github.com/MetaMask/snap-tron-wallet/pull/209))

## [1.22.0]

### Added

- Support fetching TRC20 token balances for inactive accounts using fallback endpoint ([#190](https://github.com/MetaMask/snap-tron-wallet/pull/190))
- Add security scanning for tokens sends ([#205](https://github.com/MetaMask/snap-tron-wallet/pull/205))

### Fixed

- Decode hex-encoded TRC10 token names and symbols from Full Node API responses ([#187](https://github.com/MetaMask/snap-tron-wallet/pull/187))
- Gracefully handle dismissed interface contexts during background refresh operations ([#188](https://github.com/MetaMask/snap-tron-wallet/pull/188/changes))
- Add spent bandwidth from staking as part of the calculation of current bandwidth levels. For both energy and bandwidth, clamp the result between maximum and 0 to avoid negative values ([#197](https://github.com/MetaMask/snap-tron-wallet/pull/197))

## [1.21.1]

### Fixed

- Sent transactions stuck on `pending` state ([#194](https://github.com/MetaMask/snap-tron-wallet/pull/194))

## [1.21.0]

### Fixed

- Handle extreme token amounts to prevent NaN and scientific notation in estimated changes ([#191](https://github.com/MetaMask/snap-tron-wallet/pull/191))
- Consider contract deployer's energy when calculating fees ([#192](https://github.com/MetaMask/snap-tron-wallet/pull/192))

## [1.20.0]

### Added

- Support estimating network fees with contract energy sharing mechanism ([#181](https://github.com/MetaMask/snap-tron-wallet/pull/181))

### Changed

- Optimize data synchronization to avoid duplicate API requests ([#173](https://github.com/MetaMask/snap-tron-wallet/pull/173))
- Cache chain parameters until they expire ([#171](https://github.com/MetaMask/snap-tron-wallet/pull/171))

### Fixed

- Add pre-confirmation validation to `confirmSend` flow ([#179](https://github.com/MetaMask/snap-tron-wallet/pull/179))
  - Validates that the user has enough funds to cover both the amount and all associated fees (bandwidth, energy, account activation) before showing the confirmation dialog.
- Fix missing values in simulation API request ([#176](https://github.com/MetaMask/snap-tron-wallet/pull/176))
  - The wrong parameters sent to the simulation API were causing inaccurate estimations and false negatives.
- Ensure integer amounts are passed to TronWeb's functions that involve `SUN` ([#178](https://github.com/MetaMask/snap-tron-wallet/pull/178))
- Correct inaccurate energy estimation for system contracts ([#172](https://github.com/MetaMask/snap-tron-wallet/pull/172))
- Correct mapping of `approve` type transactions ([#177](https://github.com/MetaMask/snap-tron-wallet/pull/177))

## [1.19.3]

### Fixed

- Normalize locale string when showing simulation estimated changes ([#169](https://github.com/MetaMask/snap-tron-wallet/pull/169))

## [1.19.2]

### Added

- Display error message coming from transaction simulations ([#166](https://github.com/MetaMask/snap-tron-wallet/pull/166))

## [1.19.1]

### Changed

- Simulate all Tron token type sends ([#163](https://github.com/MetaMask/snap-tron-wallet/pull/163))

## [1.19.0]

### Added

- Simulate TRC20 token sends to warn users for potential malicious transaction results ([#157](https://github.com/MetaMask/snap-tron-wallet/pull/157))

### Fixed

- Align staked TRX calculations in assets module with fee module ([#151](https://github.com/MetaMask/snap-tron-wallet/pull/151))
- Display send assets in the transaction list with the correct symbol and decimals ([#147](https://github.com/MetaMask/snap-tron-wallet/pull/147))
- Fix zero balance displayed when 'Unexpected sendIntent.rawAmount type' log appears ([#148](https://github.com/MetaMask/snap-tron-wallet/pull/148))

### Changed

- Show sTRX-\* in staked assets ([#150](https://github.com/MetaMask/snap-tron-wallet/pull/150))

## [1.18.0]

### Added

- Expose staked assets ([#141](https://github.com/MetaMask/snap-tron-wallet/pull/141))

## [1.17.0]

### Changed

- Disable security on Nile and Shasta testnets ([#135](https://github.com/MetaMask/snap-tron-wallet/pull/135))

## [1.16.0]

### Added

- Added support for multi-account feature ([#107](https://github.com/MetaMask/snap-tron-wallet/pull/107))
- Exposed Energy and Bandwidth as assets ([#110](https://github.com/MetaMask/snap-tron-wallet/pull/110))

## [1.15.1]

### Fixed

- Fix calculation of estimated TRX spent when activating a new account ([#131](https://github.com/MetaMask/snap-tron-wallet/pull/131))

## [1.15.0]

### Added

- Support for returning Market Data for tokens ([#127](https://github.com/MetaMask/snap-tron-wallet/pull/127))

### Fixed

- Avoid returning spam tokens ([#128](https://github.com/MetaMask/snap-tron-wallet/pull/128))

## [1.14.0]

### Added

- Support new asset management APIs introduced in Snaps v6.19.0 ([#123](https://github.com/MetaMask/snap-tron-wallet/pull/123))

### Changed

- Reconfigure trongrid API rate limiting to 5 QPS ([#125](https://github.com/MetaMask/snap-tron-wallet/pull/125))
- Disable rate limiting on non-mainnet environments ([#126](https://github.com/MetaMask/snap-tron-wallet/pull/126))

## [1.13.0]

### Added

- Enable Nile and Shasta networks by default ([#112](https://github.com/MetaMask/snap-tron-wallet/pull/112))

### Fixed

- Make retry with back-off more robust ([#113](https://github.com/MetaMask/snap-tron-wallet/pull/113))

## [1.12.1]

### Fixed

- Fix `confirmSend` API crash for token sends due to missing `maxBandwidth` ([#117](https://github.com/MetaMask/snap-tron-wallet/pull/117))

## [1.12.0]

### Changed

- Move trongrid API key to runtime ([#109](https://github.com/MetaMask/snap-tron-wallet/pull/109))

## [1.11.0]

### Fixed

- Add defensive check to getToAddress method ([#101](https://github.com/MetaMask/snap-tron-wallet/pull/101))

## [1.10.0]

### Fixed

- Ensure fee estimation returns values using the correct decimal precision ([#98](https://github.com/MetaMask/snap-tron-wallet/pull/98))

## [1.9.0]

### Fixed

- Add contract addresses to TronScan links ([#93](https://github.com/MetaMask/snap-tron-wallet/pull/93))

## [1.8.0]

### Added

- Add support for retrieving transaction activity history from keyring ([#87](https://github.com/MetaMask/snap-tron-wallet/pull/87))
- Display TRX spent for bandwidth in "Network Fee" field ([#91](https://github.com/MetaMask/snap-tron-wallet/pull/91))

### Fixed

- Fix transaction status not updated after broadcasting transaction ([#85](https://github.com/MetaMask/snap-tron-wallet/pull/85))

## [1.7.0]

### Added

- Detect scam address in sending flow ([#82](https://github.com/MetaMask/snap-tron-wallet/pull/82))

## [1.6.0]

### Added

- Introduced Confirmation Insights API ([#80](https://github.com/MetaMask/snap-tron-wallet/pull/80))

### Changed

- Bumped Snaps dependencies to Snaps v6.14.0 ([#80](https://github.com/MetaMask/snap-tron-wallet/pull/80))

## [1.5.0]

### Added

- Introduced Confirmation Security Insights API ([#79](https://github.com/MetaMask/snap-tron-wallet/pull/79))

## [1.4.0]

### Fixed

- Fix send flow when energy estimations are done on a new account ([#77](https://github.com/MetaMask/snap-tron-wallet/pull/77))

## [1.3.0]

### Fixed

- Energy costs paid for by the account activator are now calculated against the account activator ([#75](https://github.com/MetaMask/snap-tron-wallet/pull/75))
- Fix incorrect bandwidth cost for account activation transactions ([#74](https://github.com/MetaMask/snap-tron-wallet/pull/74))
- Fix incorrect "Account Activation Fee" tooltip text ([#73](https://github.com/MetaMask/snap-tron-wallet/pull/73))

## [1.2.0]

### Changed

- Show address book name in Send confirmation dialog ([#70](https://github.com/MetaMask/snap-tron-wallet/pull/70))
- Add checks for send flow insufficient funds scenario ([#66](https://github.com/MetaMask/snap-tron-wallet/pull/66))
- Distinguish between TRC20 contract calls and other smart contract calls in send flow ([#67](https://github.com/MetaMask/snap-tron-wallet/pull/67))

## [1.1.0]

### Fixed

- Show correct fiat amount when user inputs fiat ([#62](https://github.com/MetaMask/snap-tron-wallet/pull/62))

## [1.0.0]

### Changed

- Prepare repository for first public release ([#54](https://github.com/MetaMask/snap-tron-wallet/pull/54))
- Update link to point to external browser ([#51](https://github.com/MetaMask/snap-tron-wallet/pull/51))
- Add asset icons to all send flows ([#52](https://github.com/MetaMask/snap-tron-wallet/pull/52))
- Add review-send-trx confirmation dialog ([#47](https://github.com/MetaMask/snap-tron-wallet/pull/47))
- Extend confirmSend TRC10 to accept null or undefined assetName ([#46](https://github.com/MetaMask/snap-tron-wallet/pull/46))
- Add support for TRC10 tokens in send confirmation ([#42](https://github.com/MetaMask/snap-tron-wallet/pull/42))
- Show energy information in send flow ([#41](https://github.com/MetaMask/snap-tron-wallet/pull/41))
- Emit balance events for `TRX` instead of only during native send ([#37](https://github.com/MetaMask/snap-tron-wallet/pull/37))

### Fixed

- Fix fee calculation when estimating contract call fee where energy was incorrectly used ([#56](https://github.com/MetaMask/snap-tron-wallet/pull/56))
- Fix incorrect transaction hash after broadcast ([#50](https://github.com/MetaMask/snap-tron-wallet/pull/50))
- Update account balance after send TRX is confirmed ([#39](https://github.com/MetaMask/snap-tron-wallet/pull/39))

[Unreleased]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.22.0...HEAD
[1.22.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.21.1...snap/v1.22.0
[1.21.1]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.21.0...snap/v1.21.1
[1.21.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.20.0...snap/v1.21.0
[1.20.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.19.3...snap/v1.20.0
[1.19.3]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.19.2...snap/v1.19.3
[1.19.2]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.19.1...snap/v1.19.2
[1.19.1]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.19.0...snap/v1.19.1
[1.19.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.18.0...snap/v1.19.0
[1.18.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.17.0...snap/v1.18.0
[1.17.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.16.0...snap/v1.17.0
[1.16.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.15.1...snap/v1.16.0
[1.15.1]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.15.0...snap/v1.15.1
[1.15.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.14.0...snap/v1.15.0
[1.14.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.13.0...snap/v1.14.0
[1.13.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.12.1...snap/v1.13.0
[1.12.1]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.12.0...snap/v1.12.1
[1.12.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.11.0...snap/v1.12.0
[1.11.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.10.0...snap/v1.11.0
[1.10.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.9.0...snap/v1.10.0
[1.9.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.8.0...snap/v1.9.0
[1.8.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.7.0...snap/v1.8.0
[1.7.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.6.0...snap/v1.7.0
[1.6.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.5.0...snap/v1.6.0
[1.5.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.4.0...snap/v1.5.0
[1.4.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.3.0...snap/v1.4.0
[1.3.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.2.0...snap/v1.3.0
[1.2.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.1.0...snap/v1.2.0
[1.1.0]: https://github.com/MetaMask/snap-tron-wallet/compare/snap/v1.0.0...snap/v1.1.0
[1.0.0]: https://github.com/MetaMask/snap-tron-wallet/releases/tag/snap/v1.0.0
