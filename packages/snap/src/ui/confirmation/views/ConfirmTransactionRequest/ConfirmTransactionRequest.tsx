import {
  Address,
  Box,
  Button,
  Container,
  Footer,
  Heading,
  Icon,
  Image,
  Row,
  Section,
  Text,
  Tooltip,
  Value,
} from '@metamask/snaps-sdk/jsx';

import { Networks } from '../../../../constants';
import { i18n } from '../../../../utils/i18n';
import { ConfirmSignAndSendTransactionFormNames } from './events';
import { type ConfirmTransactionRequestContext } from './types';

export const ConfirmTransactionRequest = ({
  context: {
    origin,
    scope,
    fromAddress,
    amount,
    fee,
    preferences,
    networkImage,
  },
}: {
  context: ConfirmTransactionRequestContext;
}) => {
  const translate = i18n(preferences.locale);

  const nativeToken = Networks[scope].nativeToken;
  const nativePrice = 1
  const feeInUserCurrency = '1'

  return (
    <Container>
      <Box>
        {/* Header */}
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate(`confirmation.transaction.title`)}
          </Heading>
          <Box>{null}</Box>
        </Box>
        {/* Estimated Changes */}
        <Section>
          {/* Header + Tooltip */}
          <Box direction="horizontal" center>
            <Text fontWeight="medium">
              {translate('confirmation.estimatedChanges.title')}
            </Text>
            <Tooltip content={translate('confirmation.estimatedChanges.tooltip')}>
              <Icon name="info" />
            </Tooltip>
          </Box>
          <Box alignment="space-between" direction="horizontal">
            <Box alignment="space-between" direction="horizontal" center>
              <Text fontWeight="medium" color="alternative">
                {translate('confirmation.estimatedChanges.send')}
              </Text>
            </Box>
            <Text>{amount}</Text>
          </Box>
        </Section>

        {/* Additional Details */}
        <Section>
          {/* Request from */}
          <Box alignment="space-between" direction="horizontal">
            <Box alignment="space-between" direction="horizontal" center>
              <Text fontWeight="medium" color="alternative">
                {translate('confirmation.origin')}
              </Text>
              <Tooltip content={translate('confirmation.origin.tooltip')}>
                <Icon name="question" color="muted" />
              </Tooltip>
            </Box>
            <Text>{origin}</Text>
          </Box>
          <Box>{null}</Box>
          {/* Account */}
          <Box alignment="space-between" direction="horizontal">
            <Text fontWeight="medium" color="alternative">
              {translate('confirmation.account')}
            </Text>
            <Address
              address={`${scope}:${fromAddress}`}
              truncate
              displayName
              avatar
            />
          </Box>
          <Box>{null}</Box>
          {/* Network */}
          <Box alignment="space-between" direction="horizontal">
            <Text fontWeight="medium" color="alternative">
              {translate('confirmation.network')}
            </Text>
            <Box direction="horizontal" alignment="center">
              <Box alignment="center" center>
                <Image borderRadius="medium" src={networkImage ?? ''} />
              </Box>
              <Text>{Networks[scope].name}</Text>
            </Box>
          </Box>
          <Box>{null}</Box>
          {/* Estimated Fee */}
          <Row label={translate('confirmation.transactionFee')}>
            <Value extra={feeInUserCurrency} value={fee} />
          </Row>
        </Section>
      </Box>
      <Footer>
        <Button name={ConfirmSignAndSendTransactionFormNames.Cancel}>
          {translate(`confirmation.cancelButton`)}
        </Button>
        <Button name={ConfirmSignAndSendTransactionFormNames.Confirm}>
          {translate(`confirmation.confirmButton`)}
        </Button>
      </Footer>
    </Container>
  );
};


