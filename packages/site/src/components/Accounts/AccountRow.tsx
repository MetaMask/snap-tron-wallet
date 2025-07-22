import { Button, IconButton, Link, Table } from '@chakra-ui/react';
import { type KeyringAccount } from '@metamask/keyring-api';
import { Link as RouterLink } from 'gatsby';
import { useState } from 'react';
import { LuCopy, LuExternalLink, LuTrash } from 'react-icons/lu';

import { getExplorerUrl } from '../../../../snap/src/utils/getExplorerUrl';
import { useNetwork } from '../../context/network';
import { useInvokeKeyring, useInvokeSnap } from '../../hooks';
import { EntropySourceBadge } from '../EntropySourceBadge/EntropySourceBadge';
import { toaster } from '../Toaster/Toaster';

const TRON_TOKEN = 'slip44:195';

export const AccountRow = ({
  account,
  onRemove,
}: {
  account: KeyringAccount;
  onRemove: (id: string) => void;
}) => {
  const invokeKeyring = useInvokeKeyring();
  const invokeSnap = useInvokeSnap();
  const { network } = useNetwork();

  const [balance, setBalance] = useState('0');

  const handleCopy = (address: string) => {
    navigator.clipboard.writeText(address);
    toaster.create({
      description: 'Address copied',
      type: 'info',
    });
  };

  return (
    <Table.Row key={account.id}>
      <Table.Cell>
        <EntropySourceBadge
          entropySource={account.options?.entropySource?.toString()}
        />
      </Table.Cell>
      <Table.Cell fontFamily="monospace">
        <RouterLink to={`/${account.id}`}>
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </RouterLink>
        <IconButton
          marginLeft="1"
          onClick={() => handleCopy(account.address)}
          aria-label="Copy"
          size="sm"
          variant="ghost"
          colorPalette="purple"
        >
          <LuCopy />
        </IconButton>
        <Link
          colorPalette="purple"
          href={getExplorerUrl(network, 'address', account.address)}
          target="_blank"
          rel="noreferrer"
          marginLeft="3"
        >
          <LuExternalLink />
        </Link>
      </Table.Cell>
      <Table.Cell>{balance} SOL </Table.Cell>
      <Table.Cell textAlign="end">
        <Button
          variant="ghost"
          colorPalette="purple"
          marginLeft="1"
          size="xs"
          onClick={() => onRemove(account.id)}
        >
          <LuTrash />
        </Button>
      </Table.Cell>
    </Table.Row>
  );
};
