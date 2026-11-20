export interface QuestionResult {
  questionNumber: string;
  section: string;
  question: string;
  recognizedAnswer: string;
  expectedAnswer: string;
  aiSuggestedMarks: number;
  marksAwarded: number;
  maxMarks: number;
  feedback: string;
  confidence: number | null;
}

export interface EvaluationResult {
  evaluationId: string;
  assessmentId: string | null;
  studentId: string | null;
  totalMarks: number;
  maximumMarks: number;
  finalized: boolean;
  summary: string;
  questions: QuestionResult[];
}

export interface MasterKeySummary {
  id: string;
  fileName: string;
  createdAt: string;
  questionCount: number;
}

export interface EvaluationStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "finalized";
  stage: string;
  result: EvaluationResult | null;
  error: string | null;
}

export interface StudentUpload {
  className: string;
  rollNo: string;
  subject: string;
}

export type AssessmentType = "FA-1" | "SA-1" | "FA-2" | "SA-2" | "GA";

export interface BulkStudentResult extends StudentUpload {
  evaluationId: string;
  fileName: string;
  status: string;
  stage: string;
  totalMarks: number | null;
  maximumMarks: number | null;
  error: string | null;
  result: EvaluationResult | null;
}

export interface BulkEvaluation {
  batchId: string;
  createdAt: string;
  assessmentType?: AssessmentType;
  approved: boolean;
  status: string;
  students: BulkStudentResult[];
}
