import { RequestScope } from '../common/interfaces/scope.interface';
import { RawEvidenceCandidate, SourceQueryOptions } from './evidence.types';

export interface EvidenceSource {
  readonly name: string;

  /**
   * Retrieves raw candidate passages matching the question vector within the caller's RequestScope.
   *
   * Invariant: Implementations MUST filter by membership and active workspaceId.
   */
  query(
    question: string,
    queryVector: number[],
    scope: RequestScope,
    limit?: number,
    options?: SourceQueryOptions,
  ): Promise<RawEvidenceCandidate[]>;
}
