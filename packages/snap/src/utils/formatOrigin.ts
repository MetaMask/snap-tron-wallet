/**
 * Maps known non-URL origins to their display labels (case-insensitive lookup).
 * In-app requests use 'MetaMask' (capitalized), so the lookup is case-insensitive.
 */
const KNOWN_ORIGIN_LABELS: Record<string, string> = {
  metamask: 'MetaMask',
  'wallet-connect': 'WalletConnect',
};

/**
 * Formats an origin for display purposes.
 *
 * Returns 'Unknown' for undefined/empty origins. Returns a friendly label for
 * known origins ('metamask' to 'MetaMask', 'wallet-connect' to 'WalletConnect'),
 * matched case-insensitively. Returns the hostname for http(s) URLs. Returns an
 * empty string for everything else (channelIds, non-http URLs, invalid strings)
 * so display guards `{origin ? (...) : null}` hide the row.
 *
 * @param origin - The origin string to format (e.g., 'metamask', 'https://example.com').
 * @returns The formatted origin string (e.g., 'MetaMask', 'example.com', '').
 */
export function formatOrigin(origin: string | undefined): string {
  if (!origin) {
    return 'Unknown';
  }

  const knownLabel = KNOWN_ORIGIN_LABELS[origin.toLowerCase()];
  if (knownLabel) {
    return knownLabel;
  }

  // Try to extract hostname from URL
  try {
    const url = new URL(origin);
    return isHttpOrHttpsUrl(url) ? url.hostname : '';
  } catch {
    return '';
  }
}

/**
 * Checks whether a parsed URL uses an HTTP(S) protocol.
 *
 * @param url - The parsed URL to check.
 * @returns Whether the URL uses HTTP or HTTPS.
 */
function isHttpOrHttpsUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}
