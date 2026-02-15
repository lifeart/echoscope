// @vitest-environment jsdom
import { buildOfferUrl, buildAnswerUrl } from '../../src/ui/url-params.js';

// getOfferFromUrl/getAnswerFromUrl/clearSignalFromUrl read from the real
// `location` object which jsdom doesn't let us easily override per-test,
// so we test the pure builder functions and verify the round-trip logic.

describe('url-params', () => {
  it('buildOfferUrl produces URL with offer param', () => {
    const url = buildOfferUrl('compressed_data_here');
    expect(url).toContain('?o=compressed_data_here');
  });

  it('buildAnswerUrl produces URL with answer param', () => {
    const url = buildAnswerUrl('answer_data_here');
    expect(url).toContain('?a=answer_data_here');
  });

  it('buildOfferUrl includes origin and pathname', () => {
    const url = buildOfferUrl('abc');
    // Should be a valid absolute URL
    expect(url).toMatch(/^https?:\/\/.+\?o=abc$/);
  });

  it('clearSignalFromUrl calls history.replaceState', async () => {
    const { clearSignalFromUrl } = await import('../../src/ui/url-params.js');
    const spy = vi.spyOn(history, 'replaceState');
    clearSignalFromUrl();
    expect(spy).toHaveBeenCalledWith(null, '', location.pathname);
    spy.mockRestore();
  });

  it('getOfferFromUrl returns null when no offer param', async () => {
    // jsdom starts with empty search
    const { getOfferFromUrl } = await import('../../src/ui/url-params.js');
    expect(getOfferFromUrl()).toBeNull();
  });

  it('getAnswerFromUrl returns null when no answer param', async () => {
    const { getAnswerFromUrl } = await import('../../src/ui/url-params.js');
    expect(getAnswerFromUrl()).toBeNull();
  });
});
