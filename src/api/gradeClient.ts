import { api, ApiError } from './centralClient';
export type Decision = 'correct' | 'incorrect' | 'partial' | 'uncertain';
import type { AssessmentRequest, AssessmentResult, ConceptResult } from './generated';
export type { AssessmentRequest } from './generated';
export type GradeResult = AssessmentResult & { decision: Decision; experimental: boolean; coverage: number | null; confidence: number | null; concept_results: ConceptResult[] };
export function checkedAssessment(result: AssessmentResult): GradeResult {
  if (!result.assessment_id || !['correct', 'incorrect', 'partial', 'uncertain'].includes(result.decision ?? '')) throw new ApiError('Invalid assessment response. No review was saved.', 502);
  return { ...result, decision: result.decision!, experimental: result.experimental ?? false, coverage: result.coverage ?? null, confidence: result.confidence ?? null, concept_results: result.concept_results ?? [] };
}
export class GradeError extends Error { constructor(message: string, public statusCode: number) { super(message); } }
export const gradeAnswer = async (payload: AssessmentRequest): Promise<GradeResult> => checkedAssessment(await api<AssessmentResult>('/grade', { ...payload, language: payload.language ?? 'en', assisted: payload.assisted ?? false }));
