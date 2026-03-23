import {
  EstimatedChangesVariant,
  resolveEstimatedChangesVariant,
} from './EstimatedChanges';
import { SimulationStatus } from '../../../../services/transaction-scan/types';
import { FetchStatus } from '../../../../types/snap';

describe('resolveEstimatedChangesVariant', () => {
  it('returns Loading when scan status is Initial and simulation is enabled', () => {
    expect(
      resolveEstimatedChangesVariant({
        simulateOnChainActions: true,
        scanFetchStatus: FetchStatus.Initial,
        simulationStatus: null,
      }),
    ).toBe(EstimatedChangesVariant.Loading);
  });

  it('returns Hidden when simulation is disabled regardless of Initial status', () => {
    expect(
      resolveEstimatedChangesVariant({
        simulateOnChainActions: false,
        scanFetchStatus: FetchStatus.Initial,
        simulationStatus: null,
      }),
    ).toBe(EstimatedChangesVariant.Hidden);
  });

  it('returns Skipped when simulation is skipped', () => {
    expect(
      resolveEstimatedChangesVariant({
        simulateOnChainActions: true,
        scanFetchStatus: FetchStatus.Fetched,
        simulationStatus: SimulationStatus.Skipped,
      }),
    ).toBe(EstimatedChangesVariant.Skipped);
  });
});
