import { useEffect, useRef, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Download,
  Trash2,
  UsersRound,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { LoadingSteps } from "../components/LoadingSteps";
import { PdfUpload } from "../components/PdfUpload";
import { ResultsReview } from "../components/ResultsReview";
import {
  approveBulkEvaluation,
  cancelBulkEvaluation,
  deleteBulkEvaluation,
  discardStudentApproval,
  finalizeAllBulkEvaluation,
  getBulkEvaluation,
  listMasterKeys,
  saveMasterKey,
  startBulkEvaluation,
} from "../services/evaluationApi";
import {
  finalizeEvaluation,
  saveEvaluationMarks,
} from "../services/evaluationApi";
import type {
  BulkEvaluation,
  BulkStudentResult,
  AssessmentType,
  EvaluationResult,
  MasterKeySummary,
  StudentUpload,
} from "../types";

const MAX_PDF_SIZE = 14 * 1024 * 1024;
const MAX_BATCH_SIZE = 149 * 1024 * 1024;
const MAX_STUDENTS = 60;
const ASSESSMENT_TYPES: AssessmentType[] = ["FA-1", "SA-1", "FA-2", "SA-2", "GA"];

function parseAssessmentType(value: string): AssessmentType | "" {
  return ASSESSMENT_TYPES.find((type) => type === value) ?? "";
}

interface StudentPaper extends BulkStudentResult {
  localId: string;
  file: File;
}

function getStudentDetails(file: File): StudentUpload {
  const fileName = file.name.replace(/\.pdf$/i, "");
  const parts = fileName.split("-").filter(Boolean);

  if (parts.length >= 3) {
    return {
      className: parts[0],
      rollNo: parts[1],
      subject: parts.slice(2).join(" "),
    };
  }

  return {
    className: "",
    rollNo: parts[0] ?? fileName,
    subject: "",
  };
}

function createMarksReport(students: StudentPaper[], assessmentType: AssessmentType) {
  const approvedStudents = students.filter(
    (student) => student.status === "finalized" && student.result,
  );
  if (approvedStudents.length !== students.length || approvedStudents.length === 0) {
    return false;
  }

  const doc = new jsPDF();
  const groups = new Map<string, StudentPaper[]>();
  approvedStudents.forEach((student) => {
    const group = `${student.className.trim() || "Class"}|${student.subject.trim() || "Subject"}`;
    groups.set(group, [...(groups.get(group) ?? []), student]);
  });

  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 20;

  function drawGroupHeader(title: string, isNewPage: boolean) {
    if (isNewPage) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(title, 14, y);
    y += 14;
    doc.setFontSize(12);
    doc.text("Roll number", 14, y);
    doc.text("Marks", 150, y);
    y += 7;
    doc.setDrawColor(206, 218, 204);
    doc.line(14, y, 196, y);
    y += 8;
  }

  groups.forEach((groupStudents, group) => {
    const [className, subject] = group.split("|");
    const title = `${className} - ${subject} - ${assessmentType}`;
    drawGroupHeader(title, y > 20);

    groupStudents.forEach((student) => {
      if (y > pageHeight - 14) {
        drawGroupHeader(title, true);
      }

      const result = student.result!;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text(student.rollNo, 14, y);
      doc.text(`${result.totalMarks} / ${result.maximumMarks}`, 150, y);
      y += 9;
    });
  });

  const firstStudent = approvedStudents[0];
  const reportName = [firstStudent?.className, firstStudent?.subject, assessmentType]
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9-]+/gi, "-");
  doc.save(`${reportName || "class"}-marks.pdf`);
  return true;
}

export function AssessmentEvaluationPage() {
  const [master, setMaster] = useState<File | null>(null);
  const [masterKeys, setMasterKeys] = useState<MasterKeySummary[]>([]);
  const [masterKeyId, setMasterKeyId] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  const [masterImportStage, setMasterImportStage] = useState("");
  const [assessmentType, setAssessmentType] = useState<AssessmentType | "">("");
  const [students, setStudents] = useState<StudentPaper[]>([]);
  const [batchId, setBatchId] = useState("");
  const [batchStatus, setBatchStatus] = useState("");
  const [batchApproved, setBatchApproved] = useState(false);
  const [batchCancelled, setBatchCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [evaluationStage, setEvaluationStage] = useState("");
  const [approvingBatch, setApprovingBatch] = useState(false);
  const [cancelingBatch, setCancelingBatch] = useState(false);
  const [finalizingAll, setFinalizingAll] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const cancelRequestedRef = useRef(false);

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

    if (reviewIndex !== null && !dialog.open) {
      dialog.showModal();
    } else if (reviewIndex === null && dialog.open) {
      dialog.close();
    }
  }, [reviewIndex]);

  const selectedMasterKey = masterKeys.find((key) => key.id === masterKeyId);
  const isBatchCancelled = batchCancelled || batchStatus === "cancelled";
  const canFinalizeAll = !isBatchCancelled && students.length > 0 && students.every(
    (student) =>
      Boolean(student.result) &&
      (student.status === "completed" || student.status === "finalized"),
  );
  const batchIsReady = canFinalizeAll &&
    students.every((student) => student.status === "finalized");
  const reviewStudent = reviewIndex === null ? null : students[reviewIndex] ?? null;
  const canNavigatePrevious =
    reviewIndex !== null && students.slice(0, reviewIndex).some((student) => student.result);
  const canNavigateNext =
    reviewIndex !== null && students.slice(reviewIndex + 1).some((student) => student.result);

  function resetBatch() {
    setStudents([]);
    setBatchId("");
    setBatchStatus("");
    setBatchApproved(false);
    setBatchCancelled(false);
    setAssessmentType("");
    cancelRequestedRef.current = false;
    setReviewIndex(null);
    setError("");
    setNotice("");
  }

  async function discardBatch() {
    if (busy || finalizing || finalizingAll || approvingBatch) return;
    setError("");
    setNotice("");
    try {
      const deletedOnServer = batchId
        ? await deleteBulkEvaluation(batchId)
        : true;
      resetBatch();
      if (!deletedOnServer) {
        setNotice(
          "The folder was removed from this screen. Restart serverDotnet to remove its saved marks from the API too.",
        );
      }
    } catch (discardError) {
      setError(
        discardError instanceof Error
          ? discardError.message
          : "Could not discard the selected folder and results.",
      );
    }
  }

  function selectStudentFolder(files: FileList | null) {
    if (!files?.length) return;
    if (!assessmentType) {
      setError("Choose an assessment type before selecting the student folder.");
      return;
    }
    const selectedFiles = Array.from(files);
    const pdfFiles = selectedFiles.filter(
      (file) =>
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );

    if (pdfFiles.length === 0) {
      setError("Choose a folder containing student answer PDFs.");
      return;
    }
    if (pdfFiles.length > MAX_STUDENTS) {
      setError(`Choose no more than ${MAX_STUDENTS} student PDFs at a time.`);
      return;
    }

    const oversizedFile = pdfFiles.find((file) => file.size > MAX_PDF_SIZE);
    if (oversizedFile) {
      setError(`${oversizedFile.name} is larger than the 14 MB per-PDF limit.`);
      return;
    }

    const totalSize = pdfFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_BATCH_SIZE) {
      setError("The selected PDFs exceed the 149 MB total upload limit.");
      return;
    }

    const mapped = pdfFiles.map((file, index) => ({
      ...getStudentDetails(file),
      localId: `${file.name}-${file.lastModified}-${index}`,
      file,
      fileName: file.name,
      evaluationId: "",
      status: "selected",
      stage: "Ready to evaluate",
      totalMarks: null,
      maximumMarks: null,
      error: null,
      result: null,
    }));

    setStudents(mapped);
    setBatchId("");
    setBatchStatus("");
    setBatchApproved(false);
    setBatchCancelled(false);
    setReviewIndex(null);
    setError("");
    setNotice("");
  }

  function updateStudent(index: number, field: keyof StudentUpload, value: string) {
    setStudents((current) =>
      current.map((student, studentIndex) =>
        studentIndex === index ? { ...student, [field]: value } : student,
      ),
    );
  }

  function applyBatchResponse(snapshot: BulkEvaluation) {
    setBatchStatus(snapshot.status);
    setBatchApproved(snapshot.approved);
    setBatchCancelled(snapshot.status === "cancelled");
    const snapshotAssessmentType = parseAssessmentType(snapshot.assessmentType ?? "");
    if (snapshotAssessmentType) setAssessmentType(snapshotAssessmentType);
    setStudents((current) =>
      current.map((student, index) => {
        const remote = snapshot.students[index];
        return remote
          ? {
              ...student,
              ...remote,
              localId: student.localId,
              file: student.file,
            }
          : student;
      }),
    );
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
    resetBatch();

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

  async function runEvaluation() {
    if (!masterKeyId || !assessmentType || students.length === 0 || busy || savingMaster) return;
    const missingIdentity = students.find(
      (student) => !student.rollNo.trim() || !student.subject.trim(),
    );
    if (missingIdentity) {
      setError(`Enter a roll number and subject for ${missingIdentity.fileName}.`);
      return;
    }
    const duplicate = students.findIndex((student, index) =>
      students.some(
        (other, otherIndex) =>
          otherIndex < index &&
          other.className.trim().toLowerCase() === student.className.trim().toLowerCase() &&
          other.rollNo.trim().toLowerCase() === student.rollNo.trim().toLowerCase() &&
          other.subject.trim().toLowerCase() === student.subject.trim().toLowerCase(),
      ),
    );
    if (duplicate >= 0) {
      setError(
        `There is more than one PDF for ${students[duplicate].rollNo} in ${students[duplicate].subject}.`,
      );
      return;
    }

    setBusy(true);
    cancelRequestedRef.current = false;
    setBatchCancelled(false);
    setEvaluationStage("Uploading student PDFs");
    setError("");
    setBatchStatus("processing");
    setStudents((current) =>
      current.map((student) => ({
        ...student,
        status: "queued",
        stage: "Queued for evaluation",
        error: null,
        result: null,
      })),
    );

    try {
      const createdBatchId = await startBulkEvaluation(masterKeyId, assessmentType, students);
      setBatchId(createdBatchId);
      const delay = (milliseconds: number) =>
        new Promise((resolve) => window.setTimeout(resolve, milliseconds));

      while (true) {
        if (cancelRequestedRef.current) break;
        await delay(1200);
        if (cancelRequestedRef.current) break;
        const snapshot = await getBulkEvaluation(createdBatchId);
        if (cancelRequestedRef.current) break;
        applyBatchResponse(snapshot);
        if (snapshot.status !== "processing") break;
        const finishedCount = snapshot.students.filter(
          (student) => student.status === "completed" || student.status === "finalized" || student.status === "failed",
        ).length;
        setEvaluationStage(
          `${finishedCount} of ${snapshot.students.length} student papers complete`,
        );
      }
    } catch (evaluationError) {
      if (!cancelRequestedRef.current) {
        setError(
          evaluationError instanceof Error
            ? evaluationError.message
            : "Bulk evaluation failed. Check the .NET API.",
        );
        setBatchStatus("failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function updateMarks(questionIndex: number, value: number) {
    if (reviewIndex === null) return;
    setStudents((current) =>
      current.map((student, index) =>
        index !== reviewIndex || !student.result
          ? student
          : {
              ...student,
              result: {
                ...student.result,
                questions: student.result.questions.map((question, itemIndex) =>
                  itemIndex === questionIndex
                    ? {
                        ...question,
                        marksAwarded: Math.max(0, Math.min(question.maxMarks, value)),
                      }
                    : question,
                ),
                totalMarks: student.result.questions.reduce(
                  (sum, question, itemIndex) =>
                    sum +
                    (itemIndex === questionIndex
                      ? Math.max(0, Math.min(question.maxMarks, value))
                      : question.marksAwarded),
                  0,
                ),
              },
            },
      ),
    );
  }

  async function finalizeStudentMarks() {
    if (reviewIndex === null || finalizing) return;
    const student = students[reviewIndex];
    if (!student?.result || student.status !== "completed") return;

    setFinalizing(true);
    setError("");
    try {
      await saveEvaluationMarks(
        student.evaluationId,
        student.result.questions.map((question) => ({
          questionNumber: question.questionNumber,
          marksAwarded: question.marksAwarded,
          feedback: question.feedback,
        })),
      );
      const finalizedResult = await finalizeEvaluation(student.evaluationId);
      setStudents((current) =>
        current.map((item, index) =>
          index === reviewIndex
            ? {
                ...item,
                status: "finalized",
                stage: "Teacher approved this student's marks",
                totalMarks: finalizedResult.totalMarks,
                maximumMarks: finalizedResult.maximumMarks,
                result: finalizedResult,
              }
            : item,
        ),
      );
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : "Could not save this student's approved marks.",
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function reopenStudentMarks() {
    if (reviewIndex === null || finalizing) return;
    const student = students[reviewIndex];
    if (!student?.result || student.status !== "finalized") return;

    setFinalizing(true);
    setError("");
    try {
      const editableResult = await discardStudentApproval(student.evaluationId);
      setStudents((current) =>
        current.map((item, index) =>
          index === reviewIndex
            ? {
                ...item,
                status: "completed",
                stage: "Marks reopened for editing",
                totalMarks: editableResult.totalMarks,
                maximumMarks: editableResult.maximumMarks,
                result: editableResult,
              }
            : item,
        ),
      );
      setBatchApproved(false);
      setBatchStatus("completed");
    } catch (reopenError) {
      setError(
        reopenError instanceof Error
          ? reopenError.message
          : "Could not discard this student's approval.",
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function finalizeAllStudents() {
    if (!batchId || isBatchCancelled || !canFinalizeAll || batchIsReady || finalizingAll) return;

    setFinalizingAll(true);
    setError("");
    try {
      const finalizedBatch = await finalizeAllBulkEvaluation(batchId);
      applyBatchResponse(finalizedBatch);
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : "Could not finalize all student marks.",
      );
    } finally {
      setFinalizingAll(false);
    }
  }

  async function approveBatch() {
    if (!batchId || isBatchCancelled || batchApproved || !batchIsReady || approvingBatch) return;
    setApprovingBatch(true);
    setError("");
    try {
      const approved = await approveBulkEvaluation(batchId);
      applyBatchResponse(approved);
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : "Could not approve this class batch.",
      );
    } finally {
      setApprovingBatch(false);
    }
  }

  function downloadMarksReport() {
    setError("");
    if (!assessmentType || !batchApproved || !createMarksReport(students, assessmentType)) {
      setError("The PDF is available only after every student is finalized and the class is approved.");
    }
  }

  async function cancelEvaluation() {
    if (!batchId || cancelingBatch) return;
    cancelRequestedRef.current = true;
    setBatchCancelled(true);
    setBatchApproved(false);
    setBatchStatus("cancelled");
    setStudents((current) =>
      current.map((student) =>
        student.status === "queued" || student.status === "running" || student.status === "cancelling"
          ? {
              ...student,
              status: "cancelled",
              stage: "Cancelled by teacher",
              error: "Cancelled by teacher.",
            }
          : student,
      ),
    );
    setCancelingBatch(true);
    setError("");
    try {
      await cancelBulkEvaluation(batchId);
      setEvaluationStage("Stopping active student evaluations");
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? `${cancelError.message} The batch is locked in this screen; restart serverDotnet if the running server does not support cancellation.`
          : "Could not cancel the student evaluations. The batch is locked in this screen.",
      );
    } finally {
      setCancelingBatch(false);
    }
  }

  function cancelReview() {
    if (reviewIndex !== null) {
      setStudents((current) =>
        current.map((student, index) => {
          if (index !== reviewIndex || student.status !== "completed" || !student.result) {
            return student;
          }
          const questions = student.result.questions.map((question) => ({
            ...question,
            marksAwarded: question.aiSuggestedMarks,
          }));
          const totalMarks = questions.reduce(
            (total, question) => total + question.marksAwarded,
            0,
          );
          return {
            ...student,
            totalMarks,
            result: { ...student.result, totalMarks, questions },
          };
        }),
      );
    }
    setReviewIndex(null);
  }

  function moveReview(direction: -1 | 1) {
    if (reviewIndex === null) return;
    for (
      let index = reviewIndex + direction;
      index >= 0 && index < students.length;
      index += direction
    ) {
      if (students[index].result) {
        setReviewIndex(index);
        return;
      }
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
          <h1>Class assessment evaluation</h1>
        </div>

        <div className="upload-grid">
          <div className="upload-column">
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
                    resetBatch();
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
            <PdfUpload
              kind="master"
              title="Master answer key"
              file={master}
              selectedLabel={master ? undefined : selectedMasterKey?.fileName}
              disabled={busy || savingMaster}
              onPdf={saveAnswerKey}
              onImages={() => {}}
              onRemove={() => {
                setMaster(null);
                setMasterKeyId("");
                window.localStorage.removeItem("riddlewings.masterKeyId");
                resetBatch();
              }}
            />
            {savingMaster && (
              <div className="key-saving" role="status">
                {masterImportStage}
              </div>
            )}
          </div>

          <div className="upload-column">
            <label className="assessment-type-choice">
              <span>Assessment type</span>
              <select
                value={assessmentType}
                disabled={busy || savingMaster || students.length > 0}
                onChange={(event) => {
                  setAssessmentType(parseAssessmentType(event.currentTarget.value));
                  setError("");
                }}
              >
                <option value="">Choose an assessment type</option>
                {ASSESSMENT_TYPES.map((type) => (
                  <option value={type} key={type}>{type}</option>
                ))}
              </select>
            </label>
            <section className="upload-card folder-card">
              <div className="upload-head">
                <div className="upload-icon">
                  <UsersRound size={20} />
                </div>
                <h2>Student answers folder</h2>
              </div>
              <div className="drop-area">
                <UsersRound size={25} />
                <span>
                  {assessmentType
                    ? `Select the student PDFs for ${assessmentType}`
                    : "Choose an assessment type to enable folder upload"}
                </span>
                <label className={`file-picker ${!assessmentType ? "is-disabled" : ""}`}>
                  {assessmentType ? "Choose folder" : "Select type first"}
                  <input
                    className="file-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    disabled={!assessmentType || busy || savingMaster || Boolean(batchId)}
                    {...{ webkitdirectory: "" }}
                    onChange={(event) => {
                      selectStudentFolder(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </section>
          </div>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        {savingMaster && (
          <div className="key-saving" role="status">{masterImportStage}</div>
        )}

        {students.length > 0 && (
          <section className="student-roster" aria-labelledby="student-roster-title">
            <div className="roster-head">
              <div>
                <div className="eyebrow">CLASS RESULTS</div>
                <h2 id="student-roster-title">Student papers</h2>
                <p>{students.length} student{students.length === 1 ? "" : "s"} selected</p>
              </div>
              {batchId && (
                <span className={`batch-status ${batchApproved ? "is-approved" : ""}`}>
                  {batchApproved ? "Class approved" : batchStatus.replaceAll("_", " ")}
                </span>
              )}
            </div>

            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Answer PDF</th>
                    <th>Class</th>
                    <th>Roll number</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Marks</th>
                    <th aria-label="Review" />
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => (
                    <tr key={student.localId}>
                      <td className="paper-name" title={student.fileName}>{student.fileName}</td>
                      <td>
                        <input
                          aria-label={`Class for ${student.fileName}`}
                          value={student.className}
                          disabled={Boolean(batchId)}
                          onChange={(event) => updateStudent(index, "className", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Roll number for ${student.fileName}`}
                          value={student.rollNo}
                          disabled={Boolean(batchId)}
                          onChange={(event) => updateStudent(index, "rollNo", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Subject for ${student.fileName}`}
                          value={student.subject}
                          disabled={Boolean(batchId)}
                          onChange={(event) => updateStudent(index, "subject", event.target.value)}
                        />
                      </td>
                      <td>
                        <span className={`student-status status-${student.status}`}>
                          {student.status === "failed" ? "Failed" : student.status.replaceAll("_", " ")}
                        </span>
                        {student.error && <small className="student-error">{student.error}</small>}
                        {busy && <small className="student-stage">{student.stage}</small>}
                      </td>
                      <td className="marks-value">
                        {student.result
                          ? `${student.result.totalMarks} / ${student.result.maximumMarks}`
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="secondary-btn review-button"
                          disabled={!student.result}
                          onClick={() => setReviewIndex(index)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="roster-actions">
              <div className="roster-action-copy">
                <strong>
                  {batchApproved
                    ? "Teacher-approved class marks"
                    : batchIsReady
                      ? "All student marks are finalized"
                      : batchId
                        ? "Review and finalize student marks"
                        : "Ready to evaluate"}
                </strong>
                <span>
                  {batchApproved
                    ? "The final class report is ready to download."
                    : batchIsReady
                      ? "Approve the class to unlock the marks report."
                      : batchId
                        ? "Use each row's Review button to edit an individual score, or finalize the current marks for all students below."
                        : "Check the student details before starting the class evaluation."}
                </span>
              </div>
              <div className="roster-buttons">
                {!busy && batchId && batchStatus === "processing" && (
                  <button
                    className="danger-btn"
                    disabled={cancelingBatch}
                    onClick={cancelEvaluation}
                  >
                    {cancelingBatch ? "Cancelling…" : "Cancel evaluation"}
                  </button>
                )}
                {batchId && (
                  <button
                    className="secondary-btn"
                    disabled={busy || !canFinalizeAll || batchIsReady || finalizingAll}
                    onClick={finalizeAllStudents}
                    title="Finalize current marks for all completed students. Use each row's Review button to edit a score first."
                  >
                    {finalizingAll
                      ? "Finalizing all marks…"
                      : batchIsReady
                        ? "All students finalized"
                        : "Review all students"}
                  </button>
                )}
                {!batchId && (
                  <button
                    className="primary-btn"
                    disabled={!masterKeyId || busy || savingMaster || students.length === 0}
                    onClick={runEvaluation}
                  >
                    Evaluate all students
                  </button>
                )}
                {batchId && !batchApproved && (
                  <button
                    className="primary-btn"
                    disabled={isBatchCancelled || !batchIsReady || busy || approvingBatch}
                    onClick={approveBatch}
                  >
                    {approvingBatch ? "Approving class…" : "Approve class marks"}
                  </button>
                )}
                {batchApproved && (
                  <button
                    className="primary-btn"
                    disabled={isBatchCancelled || !students.length || students.some(
                      (student) => student.status !== "finalized" || !student.result,
                    )}
                    onClick={downloadMarksReport}
                  >
                    <Download size={17} /> Download marks report
                  </button>
                )}
                {!busy && students.length > 0 && (
                  <button
                    className="danger-btn"
                    disabled={busy || finalizing || finalizingAll || approvingBatch}
                    onClick={discardBatch}
                  >
                    <Trash2 size={16} />
                    {batchId ? "Discard batch & student folder" : "Remove student folder"}
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {(busy || savingMaster) && (
        <LoadingSteps
          preparingPhotos={false}
          title={busy ? "Evaluating all student papers" : "Preparing the master answer key"}
          stage={busy ? evaluationStage : masterImportStage}
          error={busy ? error : ""}
          cancelDisabled={
            cancelingBatch ||
            batchStatus === "cancelled" ||
            batchStatus === "completed" ||
            batchStatus === "ready_for_approval" ||
            students.some((student) => student.status === "cancelling")
          }
          onCancel={busy && batchId ? cancelEvaluation : undefined}
        />
      )}

      <dialog
        ref={reviewDialogRef}
        className="results-dialog"
        aria-labelledby="marks-dialog-title"
        onClose={cancelReview}
      >
        {reviewStudent?.result && reviewIndex !== null && (
          <ResultsReview
            result={reviewStudent.result}
            className={reviewStudent.className}
            rollNo={reviewStudent.rollNo}
            subject={reviewStudent.subject}
            currentIndex={reviewIndex}
            studentCount={students.length}
            canNavigatePrevious={canNavigatePrevious}
            canNavigateNext={canNavigateNext}
            finalized={reviewStudent.status === "finalized"}
            finalizing={finalizing}
            error={error}
            onMarks={updateMarks}
            onFinalize={finalizeStudentMarks}
            onDiscardApproval={reopenStudentMarks}
            onPrevious={() => moveReview(-1)}
            onNext={() => moveReview(1)}
            onClose={cancelReview}
          />
        )}
      </dialog>

      {batchApproved && (
        <div className="approval-confirmation" role="status">
          <CheckCircle2 size={18} /> Class results approved by the teacher.
        </div>
      )}
    </main>
  );
}
