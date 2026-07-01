/**
 * Error thrown when a TronGrid (or TronGrid-hosted full-node) HTTP request
 * fails with a non-2xx status. Carries the HTTP status code so callers can
 * react to rate-limiting (429) distinctly from other failures, and the
 * `Retry-After` header value (in seconds) when the server provides one.
 */
export class TrongridHttpError extends Error {
  readonly status: number;

  readonly retryAfter: number | undefined;

  constructor(status: number, retryAfter?: number) {
    super(`HTTP error! status: ${status}`);
    this.name = 'TrongridHttpError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Specialization of {@link TrongridHttpError} for HTTP 429 (Too Many Requests).
 * Carries the `Retry-After` hint so retry logic can honor it.
 */
export class TrongridRateLimitError extends TrongridHttpError {
  constructor(retryAfter?: number) {
    super(429, retryAfter);
    this.name = 'TrongridRateLimitError';
  }
}

/**
 * Minimal shape of a `fetch` response needed to build a typed HTTP error. The
 * SES snap environment restricts the global `Response` type, so only the
 * fields consumed here are declared.
 */
type FetchErrorResponse = {
  status: number;
  headers: {
    get: (name: string) => string | null;
  };
};

/**
 * Build the appropriate {@link TrongridHttpError} subclass from a `fetch`
 * response, parsing the `Retry-After` header (seconds) when present.
 *
 * @param response - The failing `fetch` response.
 * @returns A `TrongridRateLimitError` for 429, otherwise a `TrongridHttpError`.
 */
export const createTrongridHttpError = (
  response: FetchErrorResponse,
): TrongridHttpError => {
  const retryAfterHeader = response.headers.get('Retry-After');
  let retryAfter: number | undefined;
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    retryAfter = Number.isNaN(parsed) ? undefined : parsed;
  }

  if (response.status === 429) {
    return new TrongridRateLimitError(retryAfter);
  }

  return new TrongridHttpError(response.status, retryAfter);
};

export class TrongridAccountNotFoundError extends Error {
  constructor() {
    super('Account not found or no data returned');
    this.name = 'TrongridAccountNotFoundError';
  }
}
