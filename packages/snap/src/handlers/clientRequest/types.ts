import type { Types } from 'tronweb';

export enum ClientRequestMethod {
  SignAndSendTransaction = 'signAndSendTransaction',
  /**
   * Unified non-EVM Send
   */
  ConfirmSend = 'confirmSend',
  ComputeFee = 'computeFee',
  OnAddressInput = 'onAddressInput',
  OnAmountInput = 'onAmountInput',
  /**
   * Staking + Unstaking
   */
  ComputeStakeFee = 'computeStakeFee',
  OnStakeAmountInput = 'onStakeAmountInput',
  ConfirmStake = 'confirmStake',
  OnUnstakeAmountInput = 'onUnstakeAmountInput',
  ConfirmUnstake = 'confirmUnstake',
  ClaimUnstakedTrx = 'claimUnstakedTrx',
  ClaimTrxStakingRewards = 'claimTrxStakingRewards',
  /**
   * Sign Rewards Message
   */
  SignRewardsMessage = 'signRewardsMessage',
}

export enum SendErrorCodes {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Required = 'Required',
  Invalid = 'Invalid',
  InsufficientBalance = 'InsufficientBalance',
  InsufficientBalanceToCoverFee = 'InsufficientBalanceToCoverFee',
}

export type TransactionRawData = Types.Transaction['raw_data'] & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  fee_limit?: number;
};

export const TransactionDataSelectorsProps = {
  Approve: {
    selector: '095ea7b3',
    inputs: ['address', 'uint256'],
    method: 'approve(address,uint256)',
  },
  Transfer: {
    selector: 'a9059cbb',
    inputs: ['address', 'uint256'],
    method: 'transfer(address,uint256)',
  },
  RangoOnChainSwaps: {
    selector: '14d08fca',
    inputs: [
      'tuple(address requestId,address fromToken,address toToken,uint256 amountIn,uint256 platformFee,uint256 destinationExecutorFee,uint256 affiliateFee,address affiliatorAddress,uint256 minimumAmountExpected,bool feeFromInputToken,uint16 dAppTag,string dAppName)',
      'tuple(address spender,address target,address swapFromToken,address swapToToken,bool needsTransferFromUser,uint256 amount,bytes callData)[]',
      'address',
    ],
    method: 'onChainSwaps(tuple request,tuple[] calls,address receiver)',
  },
};

type TransactionDataMethod =
  (typeof TransactionDataSelectorsProps)[keyof typeof TransactionDataSelectorsProps]['method'];

export type DecodedTronTxData = {
  selector: string;
  method: TransactionDataMethod | 'unknown';
  receiver?: string;
  amount?: bigint;
  asset?: string;
};

type ValidateFeesForSignAndSendTransactionDataErrorsType = {
  code: string;
};
export type ValidateFeesForSignAndSendTransactionDataReturnType = {
  valid: boolean;
  errors?: ValidateFeesForSignAndSendTransactionDataErrorsType[];
};
