import {
  getSwapReferenceOwner,
  SWAP_REFERENCE_OWNER_HEX,
} from './swapReferenceOwner';
import { Network } from '../../constants';

const UNIVERSAL_ROUTER_HEX = '41a31d689a84244bc01be56e07aeafb7686f56bb89';
const EXECUTE_DATA = `3593564c${'0'.repeat(192)}`;

describe('getSwapReferenceOwner', () => {
  it('returns the reference owner for a UniversalRouter execute call on mainnet', () => {
    expect(
      getSwapReferenceOwner(
        Network.Mainnet,
        UNIVERSAL_ROUTER_HEX,
        EXECUTE_DATA,
      ),
    ).toBe(SWAP_REFERENCE_OWNER_HEX);
  });

  it('accepts mixed-case contract addresses and 0x-prefixed data', () => {
    expect(
      getSwapReferenceOwner(
        Network.Mainnet,
        UNIVERSAL_ROUTER_HEX.toUpperCase(),
        `0x${EXECUTE_DATA}`,
      ),
    ).toBe(SWAP_REFERENCE_OWNER_HEX);
  });

  it('returns null for a known router with an unknown selector', () => {
    expect(
      getSwapReferenceOwner(
        Network.Mainnet,
        UNIVERSAL_ROUTER_HEX,
        `a9059cbb${'0'.repeat(128)}`,
      ),
    ).toBeNull();
  });

  it('returns null for an unknown contract with the execute selector', () => {
    expect(
      getSwapReferenceOwner(
        Network.Mainnet,
        '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        EXECUTE_DATA,
      ),
    ).toBeNull();
  });

  it('returns null outside mainnet', () => {
    expect(
      getSwapReferenceOwner(Network.Nile, UNIVERSAL_ROUTER_HEX, EXECUTE_DATA),
    ).toBeNull();
    expect(
      getSwapReferenceOwner(Network.Shasta, UNIVERSAL_ROUTER_HEX, EXECUTE_DATA),
    ).toBeNull();
  });

  it('returns null when contract address or data is missing', () => {
    expect(
      getSwapReferenceOwner(Network.Mainnet, undefined, EXECUTE_DATA),
    ).toBeNull();
    expect(
      getSwapReferenceOwner(Network.Mainnet, UNIVERSAL_ROUTER_HEX, undefined),
    ).toBeNull();
  });
});
