import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Box,
  Section,
  Text as SnapText,
  Icon,
  Tooltip,
  Image,
  Skeleton,
} from '@metamask/snaps-sdk/jsx';

import {
  SimulationStatus,
  type TransactionScanEstimatedChanges,
} from '../../../../services/transaction-scan/types';
import { FetchStatus, type Preferences } from '../../../../types/snap';
import { formatAmount } from '../../../../utils/formatAmount';
import { i18n } from '../../../../utils/i18n';

/**
 * All visual states the EstimatedChanges component can render.
 *
 * - `Hidden`      – simulateOnChainActions is off; renders nothing.
 * - `Loading`     – security scan in progress; renders a skeleton.
 * - `Skipped`     – contract type not supported by the simulator.
 * - `Unavailable` – security scan fetch failed (network error, etc.).
 * - `Ready`       – scan complete; renders changes or a "no changes" message.
 */
export enum EstimatedChangesVariant {
  Hidden = 'hidden',
  Loading = 'loading',
  Skipped = 'skipped',
  Unavailable = 'unavailable',
  Ready = 'ready',
}

/**
 * Derives the correct visual variant from context data.
 *
 * @param options - The context values to resolve from.
 * @param options.simulateOnChainActions - Whether on-chain simulation is enabled on the user's preferences.
 * @param options.scanFetchStatus - Transport-layer status of the security scan request.
 * @param options.simulationStatus - Content-layer simulation outcome (completed, skipped, etc.).
 * @returns The variant the EstimatedChanges component should render.
 */
export function resolveEstimatedChangesVariant({
  simulateOnChainActions,
  scanFetchStatus,
  simulationStatus,
}: {
  simulateOnChainActions: boolean;
  scanFetchStatus: FetchStatus;
  simulationStatus: SimulationStatus | null;
}): EstimatedChangesVariant {
  if (!simulateOnChainActions) {
    return EstimatedChangesVariant.Hidden;
  }
  if (simulationStatus === SimulationStatus.Skipped) {
    return EstimatedChangesVariant.Skipped;
  }
  if (
    scanFetchStatus === FetchStatus.Fetching ||
    scanFetchStatus === FetchStatus.Initial
  ) {
    return EstimatedChangesVariant.Loading;
  }
  if (scanFetchStatus === FetchStatus.Error) {
    return EstimatedChangesVariant.Unavailable;
  }
  return EstimatedChangesVariant.Ready;
}

export type EstimatedChangesProps = {
  variant: EstimatedChangesVariant;
  preferences: Preferences;
  changes?: TransactionScanEstimatedChanges | null;
};

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

const EstimatedChangesHeader = ({
  preferences,
}: {
  preferences: Preferences;
}): ComponentOrElement => {
  const translate = i18n(preferences.locale);

  return (
    <Box direction="horizontal" alignment="start">
      <SnapText fontWeight="medium">
        {translate('confirmation.estimatedChanges.title')}
      </SnapText>
      <Tooltip content={translate('confirmation.estimatedChanges.tooltip')}>
        <Icon name="info" />
      </Tooltip>
    </Box>
  );
};

const AssetChange = ({
  asset,
}: {
  asset: TransactionScanEstimatedChanges['assets'][0];
}): ComponentOrElement => {
  const formattedValue = formatAmount(asset.value);
  const isOut = asset.type === 'out';

  return (
    <Box direction="horizontal" alignment="end">
      {asset.logo ? (
        <Image src={asset.logo} borderRadius="full" height={16} width={16} />
      ) : null}
      <SnapText color={isOut ? 'error' : 'success'}>
        {isOut ? '-' : '+'}
        {formattedValue} {asset.symbol}
      </SnapText>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const EstimatedChanges = ({
  variant,
  preferences,
  changes,
}: EstimatedChangesProps): ComponentOrElement => {
  const translate = i18n(preferences.locale);

  switch (variant) {
    case EstimatedChangesVariant.Hidden:
      return <Box>{null}</Box>;

    case EstimatedChangesVariant.Loading:
      return (
        <Section direction="vertical">
          <EstimatedChangesHeader preferences={preferences} />
          <Box alignment="space-between" direction="horizontal">
            <Skeleton width={60} />
            <Skeleton width={100} />
          </Box>
        </Section>
      );

    case EstimatedChangesVariant.Skipped:
      return (
        <Section direction="vertical">
          <EstimatedChangesHeader preferences={preferences} />
          <SnapText color="alternative">
            {translate('confirmation.estimatedChanges.unsupportedContract')}
          </SnapText>
        </Section>
      );

    case EstimatedChangesVariant.Unavailable:
      return (
        <Section direction="vertical">
          <EstimatedChangesHeader preferences={preferences} />
          <SnapText color="alternative">
            {translate('confirmation.estimatedChanges.notAvailable')}
          </SnapText>
        </Section>
      );

    case EstimatedChangesVariant.Ready: {
      const send =
        changes?.assets.filter((asset) => asset.type === 'out') ?? [];
      const receive =
        changes?.assets.filter((asset) => asset.type === 'in') ?? [];
      const hasChanges = send.length > 0 || receive.length > 0;

      if (!hasChanges) {
        return (
          <Section direction="vertical">
            <EstimatedChangesHeader preferences={preferences} />
            <SnapText color="alternative">
              {translate('confirmation.estimatedChanges.noChanges')}
            </SnapText>
          </Section>
        );
      }

      return (
        <Section>
          <EstimatedChangesHeader preferences={preferences} />
          {send.length > 0 ? (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.estimatedChanges.send')}
              </SnapText>
              <Box>
                {send.map((asset) => (
                  <AssetChange asset={asset} />
                ))}
              </Box>
            </Box>
          ) : null}
          {receive.length > 0 ? (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.estimatedChanges.receive')}
              </SnapText>
              <Box>
                {receive.map((asset) => (
                  <AssetChange asset={asset} />
                ))}
              </Box>
            </Box>
          ) : null}
        </Section>
      );
    }

    default:
      return <Box>{null}</Box>;
  }
};
