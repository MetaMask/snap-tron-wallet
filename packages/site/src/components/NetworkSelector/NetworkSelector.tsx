// eslint-disable-next-line @typescript-eslint/no-shadow
import { Flex, Text } from '@chakra-ui/react';
import type { FC } from 'react';

import { Network } from '../../../../snap/src/constants';
import { useNetwork } from '../../context/network';

const networks = {
  [Network.Mainnet]: 'Mainnet',
  [Network.Nile]: 'Nile',
  [Network.Shasta]: 'Shasta',
};

export const NetworkSelector: FC = () => {
  const { network: selectedNetwork, setNetwork } = useNetwork();

  return (
    <Flex direction="column" gap="2" marginBottom="5" width="full">
      <Text fontWeight="bold">Network</Text>
      <Flex gap="2">
        {Object.keys(networks).map((network) => (
          <Flex gap="2" as="label" key={network}>
            <input
              type="radio"
              name="network"
              value={network}
              // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
              checked={selectedNetwork === network}
              onChange={() => setNetwork(network as keyof typeof networks)}
            />
            {networks[network as keyof typeof networks]}
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
};
