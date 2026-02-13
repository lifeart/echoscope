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

export function buildOfferUrl(compressedOffer: string): string {
  return `${location.origin}${location.pathname}?offer=${compressedOffer}`;
}

export function buildAnswerUrl(compressedAnswer: string): string {
  return `${location.origin}${location.pathname}?answer=${compressedAnswer}`;
}
