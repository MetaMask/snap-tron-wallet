import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Box,
  Button,
  Container,
  Footer,
  Heading,
  Icon,
  Image,
  Link,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';

import { ConfirmSignAndSendTransactionFormNames } from './events';
import { type ConfirmTransactionRequestContext } from './types';
import { Networks } from '../../../../constants';
import { SecurityAlertResponse } from '../../../../services/transaction-scan/types';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';
import { FetchStatus } from '../../../../types/snap';
import { getExplorerUrl } from '../../../../utils/getExplorerUrl';
import { i18n } from '../../../../utils/i18n';
import {
  EstimatedChanges,
  resolveEstimatedChangesVariant,
} from '../../components/EstimatedChanges/EstimatedChanges';
import { Fees } from '../../components/Fees';
import { TransactionAlert } from '../../components/TransactionAlert/TransactionAlert';

export const ConfirmTransactionRequest = ({
  context: {
    origin,
    scope,
    fromAddress,
    toAddress,
    fees,
    preferences,
    networkImage,
    tokenPrices,
    tokenPricesFetchStatus,
    securityScan: { status: securityScanStatus, result: securityScanResult },
  },
}: {
  context: ConfirmTransactionRequestContext;
}): ComponentOrElement => {
  const translate = i18n(preferences.locale);

  const shouldDisableConfirmButton =
    securityScanStatus === FetchStatus.Fetching ||
    securityScanResult?.validation?.type === SecurityAlertResponse.Malicious;

  return (
    <Container>
      <Box>
        {/* Security Alert — show when alerts are on, or always when Malicious (to surface the block reason) */}
        {preferences.useSecurityAlerts ||
        securityScanResult?.validation?.type ===
          SecurityAlertResponse.Malicious ? (
          <TransactionAlert
            scanFetchStatus={securityScanStatus}
            validation={securityScanResult?.validation ?? null}
            error={securityScanResult?.error ?? null}
            preferences={preferences}
          />
        ) : null}

        {/* Header */}
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate(`confirmation.transaction.title`)}
          </Heading>
          <Box>{null}</Box>
        </Box>

        {/* Estimated Changes (from security scan simulation) */}
        <EstimatedChanges
          variant={resolveEstimatedChangesVariant({
            simulateOnChainActions: preferences.simulateOnChainActions,
            scanFetchStatus: securityScanStatus,
            simulationStatus: securityScanResult?.simulationStatus ?? null,
          })}
          changes={securityScanResult?.estimatedChanges ?? null}
          preferences={preferences}
        />

        {/* Additional Details */}
        <Section>
          {/* Request from */}
          <Box alignment="space-between" direction="horizontal">
            <Box alignment="space-between" direction="horizontal" center>
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.origin')}
              </SnapText>
              <Tooltip content={translate('confirmation.origin.tooltip')}>
                <Icon name="question" color="muted" />
              </Tooltip>
            </Box>
            <SnapText>{origin}</SnapText>
          </Box>
          <Box>{null}</Box>
          {/* From */}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.from')}
            </SnapText>
            <Link href={getExplorerUrl(scope, 'address', fromAddress ?? '')}>
              <Address
                address={`${scope}:${fromAddress}`}
                truncate
                displayName
                avatar
              />
            </Link>
          </Box>
          <Box>{null}</Box>
          {/* To */}
          {toAddress && (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.to')}
              </SnapText>
              <Link href={getExplorerUrl(scope, 'address', toAddress ?? '')}>
                <Address
                  address={`${scope}:${toAddress}`}
                  truncate
                  displayName
                  avatar
                />
              </Link>
            </Box>
          )}
          <Box>{null}</Box>
          {/* Network */}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.network')}
            </SnapText>
            <Box direction="horizontal" alignment="center">
              <Box alignment="center" center>
                <Image
                  borderRadius="medium"
                  src={networkImage ?? TRX_IMAGE_SVG}
                  height={16}
                  width={16}
                />
              </Box>
              <SnapText>{Networks[scope].name}</SnapText>
            </Box>
          </Box>
          <Box>{null}</Box>
          {/* Fee Breakdown */}
          <Fees
            fees={fees}
            preferences={preferences}
            tokenPrices={tokenPrices}
            tokenPricesFetchStatus={tokenPricesFetchStatus}
          />
        </Section>
      </Box>
      <Footer>
        <Button name={ConfirmSignAndSendTransactionFormNames.Cancel}>
          {translate(`confirmation.cancelButton`)}
        </Button>
        <Button
          name={ConfirmSignAndSendTransactionFormNames.Confirm}
          disabled={shouldDisableConfirmButton}
        >
          {translate(`confirmation.confirmButton`)}
        </Button>
      </Footer>
    </Container>
  );
};
