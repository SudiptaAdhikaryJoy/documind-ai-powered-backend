import { verifyCitations } from './citation.verifier';
import { EvidencePool } from './evidence-pool';
import { RawEvidenceCandidate } from './evidence.types';

describe('verifyCitations', () => {
  let pool: EvidencePool;

  const mockCandidate1: RawEvidenceCandidate = {
    sourceId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Payments.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 3,
    heading: 'Webhooks',
    content: 'Webhook requests include an idempotency key.',
    score: 0.85,
  };

  const mockCandidate2: RawEvidenceCandidate = {
    sourceId: 'chunk-2',
    documentId: 'doc-1',
    documentTitle: 'Payments.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 5,
    heading: 'Refunds',
    content: 'Refunds must be processed within 30 days.',
    score: 0.75,
  };

  beforeEach(() => {
    pool = new EvidencePool();
    pool.add(mockCandidate1); // e1
    pool.add(mockCandidate2); // e2
  });

  it('validates correct single citation', () => {
    const text = 'Webhook requests include an idempotency key in headers [e1].';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations.length).toBe(1);
    expect(result.citations[0].id).toBe('e1');
    expect(result.citations[0].documentTitle).toBe('Payments.pdf');
    expect(result.citations[0].pageNumber).toBe(3);
    expect(result.invalidIds).toEqual([]);
  });

  it('validates multiple distinct citations', () => {
    const text = 'Webhooks require headers [e1]. In addition, refunds take 30 days [e2].';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations.length).toBe(2);
    expect(result.citations.map((c) => c.id)).toEqual(['e1', 'e2']);
    expect(result.invalidIds).toEqual([]);
  });

  it('supports comma-separated combined citations [e1, e2]', () => {
    const text = 'Both policies apply to payment processing [e1, e2].';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations.length).toBe(2);
    expect(result.citations.map((c) => c.id)).toEqual(['e1', 'e2']);
  });

  it('handles case-insensitive citations like [E1]', () => {
    const text = 'Refer to [E1] for webhook verification.';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations.length).toBe(1);
    expect(result.citations[0].id).toBe('e1');
  });

  it('detects hallucinated citation IDs not in the evidence pool', () => {
    const text = 'Payment terms are described in [e99].';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(false);
    expect(result.invalidIds).toEqual(['e99']);
    expect(result.citations).toEqual([]);
  });

  it('detects mixed valid and invalid citations', () => {
    const text = 'Webhook details [e1] and missing clause [e4].';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(false);
    expect(result.invalidIds).toEqual(['e4']);
    expect(result.citations.length).toBe(1);
    expect(result.citations[0].id).toBe('e1');
  });

  it('returns valid when text contains no citations and no invalid citation tags', () => {
    const text = 'INSUFFICIENT_EVIDENCE';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.invalidIds).toEqual([]);
  });

  it('does not treat markdown links as citation tags', () => {
    const text = 'For more info see [Stripe Docs](https://stripe.com/docs).';
    const result = verifyCitations(text, pool);

    expect(result.isValid).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.invalidIds).toEqual([]);
  });

  it('dynamically adapts to custom evidence pool ID prefixes', () => {
    const customPool = new EvidencePool({ idPrefix: 'doc' });
    customPool.add(mockCandidate1); // doc1
    customPool.add(mockCandidate2); // doc2

    const validText = 'Verified in [doc1] and [doc2].';
    const validResult = verifyCitations(validText, customPool);
    expect(validResult.isValid).toBe(true);
    expect(validResult.citations.map((c) => c.id)).toEqual(['doc1', 'doc2']);

    const hallucinatedText = 'Claim citing [doc99].';
    const invalidResult = verifyCitations(hallucinatedText, customPool);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.invalidIds).toEqual(['doc99']);
  });
});
