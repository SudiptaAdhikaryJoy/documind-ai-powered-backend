import { EvidencePool } from './evidence-pool';
import { RawEvidenceCandidate } from './evidence.types';

describe('EvidencePool', () => {
  let pool: EvidencePool;

  const mockCandidate1: RawEvidenceCandidate = {
    sourceId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Payments API & Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 3,
    heading: 'Webhooks & Idempotency',
    content: 'Webhook requests include an idempotency key in the header.',
    score: 0.82,
  };

  const mockCandidate2: RawEvidenceCandidate = {
    sourceId: 'chunk-2',
    documentId: 'doc-1',
    documentTitle: 'Payments API & Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 5,
    heading: null,
    content: 'Refunds must be processed within 30 days of initial transaction.',
    score: 0.74,
  };

  beforeEach(() => {
    pool = new EvidencePool();
  });

  it('assigns sequential IDs e1, e2 to newly added candidate passages', () => {
    const ev1 = pool.add(mockCandidate1);
    const ev2 = pool.add(mockCandidate2);

    expect(ev1.id).toBe('e1');
    expect(ev2.id).toBe('e2');
    expect(pool.size).toBe(2);
    expect(pool.get('e1')).toBe(ev1);
    expect(pool.get('e2')).toBe(ev2);
    expect(pool.has('e1')).toBe(true);
    expect(pool.has('e3')).toBe(false);
  });

  it('deduplicates passages with the same sourceId without assigning a new ID', () => {
    const ev1 = pool.add(mockCandidate1);
    const ev1Duplicate = pool.add({ ...mockCandidate1 });

    expect(pool.size).toBe(1);
    expect(ev1Duplicate.id).toBe('e1');
    expect(ev1Duplicate).toBe(ev1);
  });

  it('records searched document titles properly', () => {
    pool.add(mockCandidate1);
    pool.recordSearchedDocument('Runbook Ops.pdf');

    const searched = pool.getSearchedDocumentTitles();
    expect(searched).toContain('Payments API & Architecture.pdf');
    expect(searched).toContain('Runbook Ops.pdf');
    expect(searched.length).toBe(2);
  });

  it('renders XML prompt passages with proper attribute escaping', () => {
    pool.add(mockCandidate1);
    pool.add(mockCandidate2);

    const xml = pool.toPromptPassages();

    expect(xml).toContain('<passages>');
    expect(xml).toContain('</passages>');
    expect(xml).toContain(
      '<passage id="e1" doc="Payments API &amp; Architecture.pdf" page="3" heading="Webhooks &amp; Idempotency">',
    );
    expect(xml).toContain(
      'Webhook requests include an idempotency key in the header.',
    );
    expect(xml).toContain(
      '<passage id="e2" doc="Payments API &amp; Architecture.pdf" page="5">',
    );
    expect(xml).toContain(
      'Refunds must be processed within 30 days of initial transaction.',
    );
  });

  it('handles empty pool prompt rendering', () => {
    expect(pool.toPromptPassages()).toBe('<passages>\n</passages>');
  });
});
