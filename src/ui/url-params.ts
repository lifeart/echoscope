/**
 * URL parameter handling for offer/answer auto-connect via QR codes.
 */

export function getOfferFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  return params.get('offer');
}

export function getAnswerFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  return params.get('answer');
}

export function clearSignalFromUrl(): void {
  history.replaceState(null, '', location.pathname);
}

/**
 * Returns the base origin suitable for QR URLs.
 * If the page was opened via localhost or 127.0.0.1, tries to resolve
 * the machine's LAN IP so the phone can actually reach it.
 */
function getLanOrigin(): string {
  const { hostname, port, protocol } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    // Vite injects import.meta.env at build time; in dev mode VITE_LAN_IP
    // can be set, but the most reliable source is the Vite server info
    // printed at startup. As a runtime heuristic we check for a
    // user-provided override first, then fall back to the current origin.
    const override = (import.meta as any).env?.VITE_LAN_IP as string | undefined;
    if (override) {
      return `${protocol}//${override}${port ? ':' + port : ''}`;
    }
    // No override available — warn and use current origin.
    // The user should open via the LAN URL that Vite prints at startup.
    console.warn(
      '[url-params] Page opened via localhost — QR URLs will point to localhost. ' +
      'Open via LAN IP instead (shown in Vite startup output) for cross-device pairing.',
    );
  }
  return location.origin;
}

export function buildOfferUrl(compressedOffer: string): string {
  return `${getLanOrigin()}${location.pathname}?offer=${compressedOffer}`;
}

export function buildAnswerUrl(compressedAnswer: string): string {
  return `${getLanOrigin()}${location.pathname}?answer=${compressedAnswer}`;
}
