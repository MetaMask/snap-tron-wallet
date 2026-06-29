import type { TransactionScanError } from './types';

/**
 * Marker returned by the security scan when a transaction is rejected because a
 * deadline has passed (e.g. an expired swap/router deadline). Surfaced in the
 * raw simulation error message and, when present, the error details type.
 */
export const TRANSACTION_DEADLINE_PASSED = 'TransactionDeadlinePassed';

/**
 * Checks whether a transaction scan error is the "deadline passed" case.
 *
 * Used to keep the confirmation dialog's submit button enabled (warn, don't
 * block) specifically for expired/deadline failures, while other failed
 * simulations continue to block submission.
 *
 * @param error - The transaction scan error, if any.
 * @returns Whether the error is the deadline-passed failure.
 */
export function isTransactionDeadlinePassedError(
  error: TransactionScanError | null,
): boolean {
  if (!error) {
    return false;
  }

  return (
    error.type === TRANSACTION_DEADLINE_PASSED ||
    Boolean(error.message?.includes(TRANSACTION_DEADLINE_PASSED))
  );
}
