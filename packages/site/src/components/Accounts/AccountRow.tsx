import { Button, IconButton, Link, Table } from '@chakra-ui/react';
import { type KeyringAccount } from '@metamask/keyring-api';
import { useState } from 'react';
import { LuCopy, LuExternalLink, LuTrash } from 'react-icons/lu';

import { getExplorerUrl } from '../../../../snap/src/utils/getExplorerUrl';
import { useNetwork } from '../../context/network';
import { EntropySourceBadge } from '../EntropySourceBadge/EntropySourceBadge';
import { toaster } from '../Toaster/Toaster';

export const AccountRow = ({
  account,
  onGetAssets,
  onGetTransactions,
  onRemove,
}: {
  account: KeyringAccount;
  onGetAssets: (id: string) => void;
  onGetTransactions: (id: string) => void;
  onRemove: (id: string) => void;
}) => {
  const { network } = useNetwork();

  const [balance] = useState('0');

  const handleCopy = async (address: string) => {
    await navigator.clipboard.writeText(address);
    toaster.create({
      description: 'Address copied',
      type: 'info',
    });
  };

  return (
    <Table.Row key={account.id}>
      <Table.Cell>
        <EntropySourceBadge
          entropySource={
            typeof account.options?.entropySource === 'object'
              ? JSON.stringify(account.options.entropySource)
              : String(account.options?.entropySource ?? '')
          }
        />
      </Table.Cell>
      <Table.Cell fontFamily="monospace">
        {account.address.slice(0, 6)}...{account.address.slice(-4)}
        <IconButton
          marginLeft="1"
          onClick={async () => handleCopy(account.address)}
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
      <Table.Cell>{balance} TRX</Table.Cell>
      <Table.Cell textAlign="end">
        <Button
          onClick={() => onGetAssets(account.id)}
          size="xs"
          colorPalette="purple"
          variant="outline"
          marginRight="2"
        >
          List assets
        </Button>
        <Button
          onClick={() => onGetTransactions(account.id)}
          size="xs"
          colorPalette="purple"
          variant="outline"
          marginRight="2"
        >
          List transactions
        </Button>
        <Button
          variant="ghost"
          colorPalette="purple"
          size="xs"
          onClick={() => onRemove(account.id)}
        >
          <LuTrash />
        </Button>
      </Table.Cell>
    </Table.Row>
  );
};
