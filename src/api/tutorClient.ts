import { api } from './centralClient';
import { checkedAssessment, type AssessmentRequest, type GradeResult, type Decision } from './gradeClient';
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface TutorChatRequest extends AssessmentRequest { history: ChatMessage[]; is_retry?: boolean }
export interface TutorChatResponse { response: string; assessment: GradeResult; evaluation: Decision; hint_provided: boolean; audio?: string }
export class TutorError extends Error { constructor(message: string, public statusCode: number) { super(message); } }
export const tutorChat = async (payload: TutorChatRequest): Promise<TutorChatResponse> => { const result = await api<TutorChatResponse>('/tutor/chat', payload); return { ...result, assessment: checkedAssessment(result.assessment) }; };
