# WPN-1527 spike — TRC-20 swap fee estimation via a reference account

Standalone prototype (no snap changes) for
[WPN-1527](https://consensyssoftware.atlassian.net/browse/WPN-1527).

**Hypothesis:** energy consumption depends on the code path, not the caller.
Dry-running a swap with `owner_address` rewritten to a MetaMask-controlled
reference account (pre-funded with USDT + standing router allowance) should
return a real `energy_used` instead of `FAILED` → 100 TRX fallback.

Key property: `triggerconstantcontract` needs **no signature**, so the
reference account's private key is never used by this script (only once,
offline, to fund it and sign the `approve`).

## Setup

No install needed — plain Node (>= 20) and `fetch`. Run from this directory:

```sh
node spike.mjs
```

Endpoints and defaults are read from `packages/snap/.env` when present
(`TRON_HTTP_BASE_URL_MAINNET`, `TRON_PRO_API_KEY`, `REFERENCE_ADDRESS`),
falling back to the public `https://api.trongrid.io`.

> Public TronGrid rate-limits aggressively (see WPN-1449) — set
> `TRON_PRO_API_KEY` if you run many tests.

## Workflow

### Phase 0 — discover routers & verify provisioning

1. Do real swaps from the extension (small amounts), collect the txids, then:

   ```sh
   node spike.mjs capture <txid>
   ```

   Each capture records the router `contract_address`, method selector and
   actual energy/fee into `data/registry.json` + `data/captures/<txid>.json`.

2. After a few captures, list every router/selector seen so far — this is the
   allowlist to `approve` from the reference account:

   ```sh
   node spike.mjs registry
   ```

3. Once the reference account is funded and approved, verify it:

   ```sh
   node spike.mjs check-ref TRef... --router TRouterA... --router TRouterB...
   # --token defaults to USDT mainnet
   ```

### Phase 1 — the substitution experiment

For each captured swap (or a JSON file with an unsigned tx / bare
`contract.parameter.value` copied from snap logs):

```sh
node spike.mjs simulate <txid> --ref TRef... --rewrite-data --bump-deadline --label "USDT->TRX sunswap 50"
```

> `--bump-deadline` matters for captured (already-mined) swaps: uniswap-style
> calldata embeds a deadline that expires within minutes, so re-simulation
> fails with `UniswapV2Router: EXPIRED` without it. Fresh unsigned
> transactions (the real snap use case) don't need it.

Variants run per `TriggerSmartContract`:

| Variant                                       | What changes                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `A:baseline`                                  | as captured — expected `FAILED` pre-approve                                                                                      |
| `B:reference-owner`                           | `owner_address` → reference account                                                                                              |
| `C:data-rewrite` (`--rewrite-data`)           | B + user address occurrences inside `data` rewritten (recipient-slot effect; required on routers that assert `to == msg.sender`) |
| `D:custom-replace` (`--replace find:replace`) | B + manual hex substitutions (e.g. clamp the amount)                                                                             |

The comparison table also shows the **current prod fallback**
(`fee_limit / energyPrice`) and, for confirmed txids, the **actual on-chain**
energy/fee — including the energy-sharing split (ticket item 4), replicated
from `FeeCalculatorService.#calculateEnergySharing`.

## Data retention (append-only, run as many tests as you like)

| File                        | Content                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `data/runs.jsonl`           | one record per simulate run: all variants, energy, fees, sharing, fallback, actual               |
| `data/events.jsonl`         | every RPC request/response, timestamped                                                          |
| `data/registry.json`        | aggregated contracts / selectors / owners across all runs, with first/last seen and source txids |
| `data/captures/<txid>.json` | full transaction + receipt snapshots                                                             |

Commit `data/` on the spike branch if you want the evidence attached to the
verdict; it is not consumed by the snap build.

## Analysis one-liners

```sh
# accuracy of reference estimate vs actual across all runs
jq -r 'select(.actual) | [.label, .selector, (.variants[] | select(.name=="B:reference-owner") | .energyUsed), .actual.energyUsageTotal, .fallback.energy] | @tsv' data/runs.jsonl

# all revert reasons seen on baseline runs
jq -r '.variants[] | select(.name=="A:baseline") | .revertReason' data/runs.jsonl | sort | uniq -c
```
