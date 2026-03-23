/* eslint-disable @typescript-eslint/naming-convention */

import type {
  SecurityAlertSimulationValidationResponse,
  SecurityScanPayload,
} from './types';
import type { ConfigProvider } from '../../services/config';
import logger, { createPrefixedLogger, type ILogger } from '../../utils/logger';

/**
 * Client for interacting with the Security Alerts API for security scanning.
 *
 * @example
 * ```typescript
 * const client = new SecurityAlertsApiClient(globalThis.fetch, logger);
 * ```
 */
export class SecurityAlertsApiClient {
  readonly #fetch: typeof globalThis.fetch;

  readonly #logger: ILogger;

  readonly #baseUrl: string;

  /**
   * Creates a new SecurityAlertsApiClient instance.
   *
   * @param configProvider - The configuration provider.
   * @param _logger - Logger instance for logging.
   */
  constructor(configProvider: ConfigProvider, _logger: ILogger) {
    this.#fetch = fetch;
    this.#logger = createPrefixedLogger(logger, '[🔒 SecurityAlertsApiClient]');
    this.#baseUrl = configProvider.get().securityAlertsApi.baseUrl;
  }

  /**
   * Scans a Tron transaction using the Security Alerts API.
   *
   * @param params - The parameters for the scan.
   * @param params.accountAddress - The account address in base58 format.
   * @param params.parameters - Extracted transaction fields (`from`, `to`, `data`, `value`).
   * @param params.origin - The origin URL of the request.
   * @param params.options - Optional scan options (simulation, validation).
   * @returns The security alert response from Security Alerts API.
   */
  async scanTransaction({
    accountAddress,
    parameters,
    origin,
    options = ['simulation', 'validation'],
  }: {
    accountAddress: string;
    parameters: SecurityScanPayload;
    origin: string;
    options?: string[];
  }): Promise<SecurityAlertSimulationValidationResponse> {
    this.#logger.info('Scanning Tron transaction with Security Alerts API');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      accept: 'application/json',
    };

    const response = await this.#fetch(
      `${this.#baseUrl}/tron/transaction/scan`,
      {
        headers,
        method: 'POST',
        body: JSON.stringify({
          account_address: accountAddress,
          metadata: {
            domain: origin,
          },
          data: parameters,
          options,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      this.#logger.error(
        `Security Alerts API error: ${response.status} - ${JSON.stringify(errorBody)}`,
      );
      throw new Error(
        `Security Alerts API error: ${response.status} - ${JSON.stringify(errorBody)}`,
      );
    }

    return await response.json();
  }
}
