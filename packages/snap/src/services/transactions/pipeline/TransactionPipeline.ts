/* istanbul ignore file */

import type { Json } from '@metamask/snaps-sdk';

import type { TransactionPipelineStep } from './types';

export class TransactionPipeline {
  async execute<Context>({
    context,
    steps,
  }: {
    context: Context;
    steps: TransactionPipelineStep<Context>[];
  }): Promise<Json> {
    let currentContext = context;

    for (const step of steps) {
      const result = await step(currentContext);

      if (result.type === 'return') {
        return result.response;
      }

      currentContext = result.context;
    }

    throw new Error('Transaction pipeline completed without a response');
  }
}
