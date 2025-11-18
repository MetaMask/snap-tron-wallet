import { Button, Text as ChakraText, Flex, Table } from '@chakra-ui/react';
import { KeyringRpcMethod, type KeyringAccount } from '@metamask/keyring-api';
import { useEffect, useState } from 'react';

import { AccountRow } from './AccountRow';
import { TestDappRpcRequestMethod } from '../../../../snap/src/handlers/rpc/types';
import { useInvokeKeyring } from '../../hooks/useInvokeKeyring';
import { useInvokeSnap } from '../../hooks/useInvokeSnap';

export const Accounts = () => {
  const [accounts, setAccounts] = useState<KeyringAccount[]>();
  const invokeKeyring = useInvokeKeyring();
  const invokeSnap = useInvokeSnap();

  const fetchAccounts = async () => {
    const accountList = ((await invokeKeyring({
      method: KeyringRpcMethod.ListAccounts,
    })) ?? []) as KeyringAccount[];

    const sortedByEntropySource = accountList.sort((a, b) => {
      const aEntropyId =
        a.options?.entropy?.type === 'mnemonic' ? a.options.entropy.id : '';
      const bEntropyId =
        b.options?.entropy?.type === 'mnemonic' ? b.options.entropy.id : '';

      if (aEntropyId && bEntropyId) {
        return aEntropyId.localeCompare(bEntropyId);
      }
      return 0;
    });

    setAccounts(sortedByEntropySource);
  };

  const handleCreateAccount = async () => {
    await invokeKeyring({
      method: KeyringRpcMethod.CreateAccount,
      params: { options: {} },
    });
    await fetchAccounts();
  };

  const handleGetAssets = async (id: string) => {
    await invokeKeyring({
      method: KeyringRpcMethod.ListAccountAssets,
      params: { id },
    });
  };

  const handleGetTransactions = async (id: string) => {
    await invokeKeyring({
      method: KeyringRpcMethod.ListAccountTransactions,
      params: { id, pagination: { limit: 10 } },
    });
  };

  const handleDeleteAccount = async (id: string) => {
    await invokeKeyring({
      method: KeyringRpcMethod.DeleteAccount,
      params: { id },
    });
    await fetchAccounts();
  };

  const computeFee = async () => {
    if (!accounts || accounts.length === 0) {
      console.warn('No accounts available to compute fee.');
      return;
    }

    const accountId = accounts[0]?.id;
    if (!accountId) {
      console.warn('No valid account ID found.');
      return;
    }

    const result = await invokeSnap({
      method: TestDappRpcRequestMethod.ComputeFee,
      params: {
        accountId,
        scope: 'tron:728126428', // Tron mainnet
        transaction:
          'CgK0FiII40phBu42/OZAkJyY96YzWrADCB8SqwMKMXR5cGUuZ29vZ2xlYXBpcy5jb20vcHJvdG9jb2wuVHJpZ2dlclNtYXJ0Q29udHJhY3QS9QIKFUEU0B62M0bakw7g2jDVhRrBTODEeRIVQZlGn9WqCM/oNjlc6ZPA69Vn4sFPIsQCnd+TuwAAAAAAAAAAAAAAAKYU+AO2/XgJhqQseOycf3fm3tE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC+vCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnq6OQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF1RSWHxzeWtuZjl8MC41fGJyaWRnZXJzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACJUQnNGcUttbVJ5WWNuWUphOFlEeFk1ZDJKQVJhSGVxdUJKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcLzdlPemMw==',
        options: {
          type: 'TriggerSmartContract',
          visible: false,
        },
      },
    });

    console.log('Compute fee result:', result);
  };

  useEffect(() => {
    const loadAccounts = async () => {
      await fetchAccounts();
    };
    loadAccounts().catch(console.error);
  }, []);

  return (
    <Flex direction="column" width="full" marginBottom="5">
      <Flex align="center" justifyContent="space-between">
        <ChakraText textStyle="2xl" marginBottom="5">
          Accounts
        </ChakraText>
        <Flex>
          <Button colorPalette="purple" onClick={computeFee} marginRight="3">
            Compute Fee
          </Button>
          <Button colorPalette="purple" onClick={fetchAccounts} marginRight="3">
            Refresh
          </Button>
          <Button colorPalette="purple" onClick={handleCreateAccount}>
            Add account
          </Button>
        </Flex>
      </Flex>
      <Table.Root marginTop="4" variant="line">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>SRP</Table.ColumnHeader>
            <Table.ColumnHeader>Address</Table.ColumnHeader>
            <Table.ColumnHeader>Balance</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end"></Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {accounts?.map((account) => {
            return (
              <AccountRow
                key={account.id}
                account={account}
                onGetAssets={handleGetAssets}
                onGetTransactions={handleGetTransactions}
                onRemove={handleDeleteAccount}
              />
            );
          })}
        </Table.Body>
      </Table.Root>
    </Flex>
  );
};
