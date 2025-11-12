import {
  Box,
  Button,
  Container,
  Footer,
  Heading,
  Text,
} from '@metamask/snaps-sdk/jsx';

import { Networks } from '../../../../constants';
import { i18n } from '../../../../utils/i18n';
import { ConfirmSignAndSendTransactionFormNames } from './events';
import { type ConfirmTransactionRequestContext } from './types';

export const ConfirmTransactionRequest = ({
  context: {
    scope,
    fromAddress,
    amount,
    fee,
    preferences,
  },
}: {
  context: ConfirmTransactionRequestContext;
}) => {
  const translate = i18n(preferences.locale);

  const nativeToken = Networks[scope].nativeToken;
  const nativePrice = 1

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate(`confirmation.signAndSendTransaction.title`)}
          </Heading>
          <Box>{null}</Box>
        </Box>

        <Box>
          <Text>
            {translate(`confirmation.account`)}: {fromAddress ?? '-'}
          </Text>
          <Text>
            {translate(`confirmation.network`)}: {Networks[scope].name}
          </Text>
          <Text>
            {translate(`confirmation.estimatedFee`)}:{' '}
            { fee ? `${fee} ${nativeToken.symbol}` : '-'}
          </Text>
          {nativePrice ? (
            <Text>
              {translate(`confirmation.nativePrice`)}:{' '}
              {String(nativePrice)} {preferences.currency.toUpperCase()}
            </Text>
          ) : null}
          <Text>
            {translate(`confirmation.origin`)}: MetaMask
          </Text>
        </Box>
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


