import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Banner,
  Box,
  Icon,
  Link,
  Skeleton,
  Text as SnapText,
  type BannerProps,
} from '@metamask/snaps-sdk/jsx';

import { getErrorMessage } from './getErrorMessage';
import type {
  TransactionScanError,
  TransactionScanValidation,
} from '../../../../services/transaction-scan/types';
import { FetchStatus, type Preferences } from '../../../../types/snap';
import { i18n } from '../../../../utils/i18n';

export type TransactionAlertProps = {
  preferences: Preferences;
  validation: TransactionScanValidation | null;
  error: TransactionScanError | null;
  scanFetchStatus: FetchStatus;
};

const VALIDATION_TYPE_TO_SEVERITY: Partial<
  Record<
    NonNullable<TransactionScanValidation['type']>,
    BannerProps['severity']
  >
> = {
  Malicious: 'danger',
  Warning: 'warning',
};

export const TransactionAlert = ({
  preferences,
  validation,
  error,
  scanFetchStatus,
}: TransactionAlertProps): ComponentOrElement => {
  const translate = i18n(preferences.locale);

  if (scanFetchStatus === FetchStatus.Fetching) {
    return (
      <Box>
        <Skeleton height="40px" />
      </Box>
    );
  }

  if (scanFetchStatus === FetchStatus.Error) {
    return (
      <Banner
        title={translate('confirmation.simulationFetchErrorTitle')}
        severity="warning"
      >
        <SnapText>
          {translate('confirmation.simulationFetchErrorSubtitle')}
        </SnapText>
      </Banner>
    );
  }

  const severity = validation?.type
    ? VALIDATION_TYPE_TO_SEVERITY[validation.type]
    : undefined;

  if (severity) {
    return (
      <Banner
        title={translate('confirmation.validationErrorTitle')}
        severity={severity}
      >
        <SnapText>{translate('confirmation.validationErrorSubtitle')}</SnapText>
        <SnapText size="sm">
          <Link href="https://support.metamask.io/configure/wallet/how-to-turn-on-security-alerts/">
            {translate('confirmation.validationErrorLearnMore')}
          </Link>
        </SnapText>
        <SnapText size="sm">
          <Icon color="primary" name="security-tick" />{' '}
          {translate('confirmation.validationErrorSecurityAdviced')}{' '}
          <Link href="https://www.blockaid.io">Blockaid</Link>
        </SnapText>
      </Banner>
    );
  }

  if (error) {
    return (
      <Banner
        title={translate('confirmation.simulationErrorTitle')}
        severity="warning"
      >
        <SnapText>
          {translate('confirmation.simulationErrorSubtitle', {
            reason: getErrorMessage(error, preferences),
          })}
        </SnapText>
      </Banner>
    );
  }

  return <Box>{null}</Box>;
};
