import { CheckCircle2, Info, X } from "lucide-react";
import type { EvaluationResult } from "../types";

interface Props {
  result: EvaluationResult;
  onMarks: (index: number, value: number) => void;
  onFeedback: (index: number, value: string) => void;
  finalized: boolean;
  finalizing: boolean;
  error: string;
  onFinalize: () => void;
  onClose: () => void;
}

export function ResultsReview({
  result,
  onMarks,
  onFeedback,
  finalized,
  finalizing,
  error,
  onFinalize,
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
          <div className="eyebrow">AI EVALUATION COMPLETE</div>
          <h2 id="marks-dialog-title">Question-wise marks review</h2>
          <p>{result.summary}</p>
        </div>
        <div className="total-score">
          <span>{finalized ? "Final score" : "Suggested score"}</span>
          <strong>
            {total}
            <small> / {max}</small>
          </strong>
        </div>
        <button
          className="icon-btn results-close"
          onClick={onClose}
          aria-label="Close marks review"
        >
          <X size={20} />
        </button>
      </div>

      <div className="review-notice">
        <Info size={16} /> AI marks are suggestions. Verify the recognized
        handwriting and edit marks before finalizing.
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
              <div>
                <label>Recognized student answer</label>
                <p>{question.recognizedAnswer || "No answer recognized"}</p>
              </div>
              <div>
                <label>Master answer / expected response</label>
                <p>{question.expectedAnswer}</p>
              </div>
            </div>
            <div className="question-footer">
              <label className="feedback-editor">
                <span>Teacher feedback</span>
                <textarea
                  value={question.feedback}
                  disabled={finalized}
                  onChange={(event) => onFeedback(index, event.target.value)}
                />
              </label>
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
                        Math.min(
                          question.maxMarks,
                          Number(event.target.value),
                        ),
                      ),
                    )
                  }
                />
                <small>
                  AI suggested {question.aiSuggestedMarks} / {question.maxMarks}
                </small>
              </label>
            </div>
          </article>
        ))}
      </div>

      <div className="publish-row">
        <div>
          <strong>Teacher approval required</strong>
          <span>
            {finalized
              ? "These teacher-approved marks are finalized."
              : "Review answers, edit marks and feedback, then finalize."}
          </span>
        </div>
        <button
          className="primary-btn"
          onClick={onFinalize}
          disabled={finalized || finalizing}
        >
          {finalized ? (
            <>
              <CheckCircle2 size={17} /> Finalized
            </>
          ) : (
            <>{finalizing ? "Saving approved marks…" : "Approve & finalize marks"}</>
          )}
        </button>
      </div>
      {finalized && (
        <div className="published-note">
          <CheckCircle2 size={17} /> Teacher-approved marks are saved for this
          evaluation. Student-dashboard publishing requires your LMS integration.
        </div>
      )}
    </section>
  );
}