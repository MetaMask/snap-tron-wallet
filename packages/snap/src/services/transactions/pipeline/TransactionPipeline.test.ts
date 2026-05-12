import { TransactionPipeline } from './TransactionPipeline';
import type { TransactionPipelineStep } from './types';

describe('TransactionPipeline', () => {
  it('passes context through steps in order', async () => {
    const pipeline = new TransactionPipeline();
    const result = await pipeline.execute({
      context: { value: 1 },
      steps: [
        async (context) => ({
          type: 'continue',
          context: { ...context, value: context.value + 1 },
        }),
        async (context) => ({
          type: 'return',
          response: { value: context.value + 1 },
        }),
      ],
    });

    expect(result).toStrictEqual({ value: 3 });
  });

  it('stops when a step returns a response', async () => {
    const pipeline = new TransactionPipeline();
    const nextStep = jest.fn() as jest.MockedFunction<
      TransactionPipelineStep<Record<string, never>>
    >;

    const result = await pipeline.execute({
      context: {},
      steps: [
        async () => ({ type: 'return', response: { done: true } }),
        nextStep,
      ],
    });

    expect(result).toStrictEqual({ done: true });
    expect(nextStep).not.toHaveBeenCalled();
  });

  it('throws when the pipeline completes without a response', async () => {
    const pipeline = new TransactionPipeline();

    await expect(
      pipeline.execute({
        context: {},
        steps: [async (context) => ({ type: 'continue', context })],
      }),
    ).rejects.toThrow('Transaction pipeline completed without a response');
  });
});
