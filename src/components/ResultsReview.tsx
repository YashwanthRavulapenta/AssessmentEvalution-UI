import { ArrowLeft, CheckCircle2, Info, X } from "lucide-react";
import type { EvaluationResult } from "../types";

interface Props {
  result: EvaluationResult;
  className: string;
  rollNo: string;
  subject: string;
  currentIndex: number;
  studentCount: number;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  finalized: boolean;
  finalizing: boolean;
  error: string;
  onMarks: (questionIndex: number, value: number) => void;
  onFinalize: () => void;
  onDiscardApproval: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function ResultsReview({
  result,
  className,
  rollNo,
  subject,
  currentIndex,
  studentCount,
  canNavigatePrevious,
  canNavigateNext,
  finalized,
  finalizing,
  error,
  onMarks,
  onFinalize,
  onDiscardApproval,
  onPrevious,
  onNext,
  onClose,
}: Props) {
  const total = result.questions.reduce(
    (sum, question) => sum + question.marksAwarded,
    0,
  );
  const max = result.questions.reduce(
    (sum, question) => sum + question.maxMarks,
    0,
  );

  return (
    <section className="results-section">
      <div className="results-head">
        <div>
          <div className="eyebrow">
            STUDENT {currentIndex + 1} OF {studentCount}
          </div>
          <h2 id="marks-dialog-title">Review student answers</h2>
          <p>
            {className && `${className} · `}
            Roll {rollNo}
            {subject && ` · ${subject}`}
          </p>
        </div>
        <div className="total-score">
          <span>{finalized ? "Approved score" : "Suggested score"}</span>
          <strong>
            {total}
            <small> / {max}</small>
          </strong>
        </div>
        <button
          className="icon-btn results-close"
          onClick={onClose}
          aria-label="Cancel review and return to student list"
        >
          <X size={20} />
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="question-list">
        {result.questions.map((question, index) => (
          <article
            className="question-result"
            key={`${question.questionNumber}-${index}`}
          >
            <div className="question-title">
              <strong>
                {question.questionNumber}. {question.question}
              </strong>
              <span>{question.section}</span>
            </div>
            <div className="answer-grid">
              <div className="student-answer">
                <label>Student answer</label>
                <p>{question.recognizedAnswer || "No answer recognized"}</p>
              </div>
              <div className="master-answer">
                <label>Master answer</label>
                <p>{question.expectedAnswer || "No expected answer provided"}</p>
              </div>
            </div>
            <div className="question-footer">
              <span className="ai-mark">
                AI suggested {question.aiSuggestedMarks} / {question.maxMarks}
              </span>
              <label className="mark-editor">
                <span>Teacher marks</span>
                <input
                  type="number"
                  min="0"
                  max={question.maxMarks}
                  step="0.5"
                  value={question.marksAwarded}
                  disabled={finalized}
                  onChange={(event) =>
                    onMarks(
                      index,
                      Math.max(
                        0,
                        Math.min(question.maxMarks, Number(event.target.value)),
                      ),
                    )
                  }
                />
                <small>/ {question.maxMarks}</small>
              </label>
            </div>
          </article>
        ))}
      </div>


      <div className="publish-row">
        <div>
          <strong>{finalized ? "Student marks approved" : "Teacher approval required"}</strong>
          <span>
            {finalized
              ? "Discard this approval to edit the score and approve it again."
              : "Approve this student's marks after checking the answers."}
          </span>
        </div>
        <button
          className={finalized ? "danger-btn" : "primary-btn"}
          onClick={finalized ? onDiscardApproval : onFinalize}
          disabled={finalizing}
        >
          {finalized ? (
            <>{finalizing ? "Reopening marks…" : "Discard approval & edit"}</>
          ) : (
            <>
              {finalizing ? "Saving marks…" : "Approve student marks"}
              {!finalizing && <CheckCircle2 size={17} />}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
