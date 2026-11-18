import { useEffect, useRef, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { jsPDF } from "jspdf";
import { LoadingSteps } from "../components/LoadingSteps";
import { PdfUpload } from "../components/PdfUpload";
import { ResultsReview } from "../components/ResultsReview";
import {
  evaluatePapers,
  finalizeEvaluation,
  listMasterKeys,
  saveEvaluationMarks,
  saveMasterKey,
} from "../services/evaluationApi";
import type { EvaluationResult, MasterKeySummary } from "../types";

const MAX_PDF_SIZE = 14 * 1024 * 1024;

async function photosToPdf(files: File[]) {
  const pdf = new jsPDF({ compress: true });

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });

    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error(`Could not open ${file.name} as an image.`));
      image.src = imageData;
    });

    const maxDimension = 1800;
    const scale = Math.min(
      1,
      maxDimension / image.width,
      maxDimension / image.height,
    );
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare an image for the answer sheet.");
    }

    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpegData = canvas.toDataURL("image/jpeg", 0.82);

    if (index > 0) pdf.addPage();

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / width, pageHeight / height);
    const imageWidth = width * ratio;
    const imageHeight = height * ratio;

    pdf.addImage(
      jpegData,
      "JPEG",
      (pageWidth - imageWidth) / 2,
      (pageHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
    );
  }

  return new File([pdf.output("blob")], "student-answer-sheet.pdf", {
    type: "application/pdf",
  });
}

export function AssessmentEvaluationPage() {
  const [master, setMaster] = useState<File | null>(null);
  const [masterKeys, setMasterKeys] = useState<MasterKeySummary[]>([]);
  const [masterKeyId, setMasterKeyId] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  const [masterImportStage, setMasterImportStage] = useState("");
  const [student, setStudent] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [evaluationStage, setEvaluationStage] = useState("");
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const photoFilesRef = useRef<File[]>([]);
  const photoConversionRef = useRef(false);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    listMasterKeys()
      .then((keys) => {
        if (!active) return;
        setMasterKeys(keys);
        const savedId = window.localStorage.getItem("riddlewings.masterKeyId");
        if (savedId && keys.some((key) => key.id === savedId)) {
          setMasterKeyId(savedId);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load saved answer keys.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (!dialog) return;

    if (reviewOpen && !dialog.open) {
      dialog.showModal();
    } else if (!reviewOpen && dialog.open) {
      dialog.close();
    }
  }, [reviewOpen]);

  async function addPhotos(files: FileList) {
    if (photoConversionRef.current || busy) return;

    const selectedPhotos = Array.from(files);
    if (!selectedPhotos.length) return;

    photoConversionRef.current = true;
    setPreparingPhotos(true);
    setError("");

    try {
      const allPhotos = [...photoFilesRef.current, ...selectedPhotos];
      const photoPdf = await photosToPdf(allPhotos);
      if (photoPdf.size > MAX_PDF_SIZE) {
        throw new Error("The generated answer sheet PDF must be 14 MB or smaller.");
      }

      photoFilesRef.current = allPhotos;
      setStudent(photoPdf);
      setPhotoCount(allPhotos.length);
      setResult(null);
      setFinalized(false);
      setReviewOpen(false);
    } catch (conversionError) {
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "Could not prepare the selected photos.",
      );
    } finally {
      photoConversionRef.current = false;
      setPreparingPhotos(false);
    }
  }

  async function run() {
    if (!masterKeyId || !student || busy || preparingPhotos || savingMaster) return;
    if (student.size > MAX_PDF_SIZE) {
      setError("The student answer-sheet PDF must be 14 MB or smaller.");
      return;
    }

    setBusy(true);
    setEvaluationStage("Waiting for an evaluation worker");
    setError("");
    setResult(null);
    setFinalized(false);
    setReviewOpen(false);

    try {
      const evaluation = await evaluatePapers(
        masterKeyId,
        student,
        setEvaluationStage,
      );
      if (!evaluation.questions?.length) {
        throw new Error(
          "AI returned no question-wise results. Try clearer scans.",
        );
      }
      setResult(evaluation);
      setReviewOpen(true);
    } catch (evaluationError) {
      setError(
        evaluationError instanceof Error
          ? evaluationError.message
          : "Evaluation failed. Check the AI server.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswerKey(file: File) {
    if (file.size > MAX_PDF_SIZE) {
      setError("The master answer-key PDF must be 14 MB or smaller.");
      return;
    }

    setSavingMaster(true);
    setMasterImportStage("Uploading PDF to the API");
    setError("");
    setMaster(null);
    setMasterKeyId("");
    clearResult();

    try {
      const savedKey = await saveMasterKey(file, setMasterImportStage);
      setMasterKeys((current) => [
        savedKey,
        ...current.filter((key) => key.id !== savedKey.id),
      ]);
      setMaster(file);
      setMasterKeyId(savedKey.id);
      window.localStorage.setItem("riddlewings.masterKeyId", savedKey.id);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not extract and save the master answer key.",
      );
    } finally {
      setSavingMaster(false);
      setMasterImportStage("");
    }
  }

  const selectedMasterKey = masterKeys.find((key) => key.id === masterKeyId);

  function clearResult() {
    setResult(null);
    setFinalized(false);
    setReviewOpen(false);
  }

  function updateMarks(index: number, value: number) {
    setResult((currentResult) =>
      currentResult
        ? {
            ...currentResult,
            questions: currentResult.questions.map((question, questionIndex) =>
              questionIndex === index
                ? { ...question, marksAwarded: value }
                : question,
            ),
          }
        : currentResult,
    );
  }

  function updateFeedback(index: number, value: string) {
    setResult((currentResult) =>
      currentResult
        ? {
            ...currentResult,
            questions: currentResult.questions.map((question, questionIndex) =>
              questionIndex === index
                ? { ...question, feedback: value }
                : question,
            ),
          }
        : currentResult,
    );
  }

  async function finalizeMarks() {
    if (!result || finalized || finalizing) return;
    setFinalizing(true);
    setError("");

    try {
      await saveEvaluationMarks(
        result.evaluationId,
        result.questions.map((question) => ({
          questionNumber: question.questionNumber,
          marksAwarded: question.marksAwarded,
          feedback: question.feedback,
        })),
      );
      const savedResult = await finalizeEvaluation(result.evaluationId);
      setResult(savedResult);
      setFinalized(true);
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : "Could not save and finalize the teacher-approved marks.",
      );
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <a className="brand" href="#" aria-label="RiddleWings home">
          <div className="brand-logo">
            <BookOpenCheck size={22} />
          </div>
          <strong>RiddleWings</strong>
        </a>
      </header>

      <div className="content">
        <div className="intro">
          <h1 style={{textAlign:"center"}}>Assessment evaluation</h1>
        </div>

        <div className="upload-grid">
          <div className="upload-column">
            <PdfUpload
              kind="master"
              title="Master answer key"
              file={master}
              selectedLabel={master ? undefined : selectedMasterKey?.fileName}
              disabled={busy || preparingPhotos || savingMaster}
              onPdf={saveAnswerKey}
              onImages={() => {}}
              onRemove={() => {
                setMaster(null);
                setMasterKeyId("");
                window.localStorage.removeItem("riddlewings.masterKeyId");
                clearResult();
              }}
            />
            {masterKeys.length > 0 && (
              <label className="master-key-choice">
                <span>Use a saved answer key</span>
                <select
                  value={masterKeyId}
                  disabled={busy || savingMaster}
                  onChange={(event) => {
                    setMaster(null);
                    setMasterKeyId(event.currentTarget.value);
                    window.localStorage.setItem(
                      "riddlewings.masterKeyId",
                      event.currentTarget.value,
                    );
                    clearResult();
                  }}
                >
                  <option value="">Choose an answer key</option>
                  {masterKeys.map((key) => (
                    <option value={key.id} key={key.id}>
                      {key.fileName} ({key.questionCount} questions)
                    </option>
                  ))}
                </select>
              </label>
            )}
            {savingMaster && (
              <div className="key-saving" role="status">
                {masterImportStage}
              </div>
            )}
          </div>
          <PdfUpload
            kind="student"
            title="Student answer sheet"
            file={student}
            photoCount={photoCount}
            disabled={busy || preparingPhotos || savingMaster}
            onPdf={(file) => {
              if (file.size > MAX_PDF_SIZE) {
                setError("The student answer-sheet PDF must be 14 MB or smaller.");
                return;
              }
              photoFilesRef.current = [];
              setPhotoCount(0);
              setStudent(file);
              clearResult();
            }}
            onImages={addPhotos}
            onRemove={() => {
              photoFilesRef.current = [];
              setPhotoCount(0);
              setStudent(null);
              clearResult();
            }}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button
          className="primary-btn evaluate-button"
          disabled={!masterKeyId || !student || busy || preparingPhotos || savingMaster}
          onClick={result ? () => setReviewOpen(true) : run}
        >
          {result ? "Review marks" : "Evaluate answer sheet"}
        </button>
      </div>

      {(busy || preparingPhotos) && (
        <LoadingSteps
          preparingPhotos={preparingPhotos}
          stage={evaluationStage}
        />
      )}

      <dialog
        ref={reviewDialogRef}
        className="results-dialog"
        aria-labelledby="marks-dialog-title"
        onClose={() => setReviewOpen(false)}
      >
        {result && (
          <ResultsReview
            result={result}
            onMarks={updateMarks}
            onFeedback={updateFeedback}
            finalized={finalized}
            finalizing={finalizing}
            error={error}
            onFinalize={finalizeMarks}
            onClose={() => setReviewOpen(false)}
          />
        )}
      </dialog>
    </main>
  );
}
