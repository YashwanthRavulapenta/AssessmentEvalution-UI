import type {
  EvaluationResult,
  EvaluationStatus,
  BulkEvaluation,
  MasterKeySummary,
  StudentUpload,
} from "../types";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001/api";

function getErrorMessage(body: string, response: Response): string {
  if (body.trim()) {
    try {
      const data = JSON.parse(body) as { error?: unknown; title?: unknown };
      if (typeof data.error === "string") return data.error;
      if (typeof data.title === "string") return data.title;
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
      return body;
    }
  }

  if (response.status === 404 || response.status === 405) {
    return "The running API does not support this action yet. Restart serverDotnet and try again.";
  }
  return `Request failed (${response.status} ${response.statusText}).`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let data: ({ error?: string } & T) | undefined;
  if (body) {
    try {
      data = JSON.parse(body) as { error?: string } & T;
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
      if (response.ok) throw new Error("The API returned invalid JSON.");
    }
  }
  if (!response.ok) {
    throw new Error(getErrorMessage(body, response));
  }
  if (!data) throw new Error("The API returned an empty response.");
  return data;
}

export async function listMasterKeys(): Promise<MasterKeySummary[]> {
  return readJson<MasterKeySummary[]>(await fetch(`${API}/master-keys`));
}

export async function saveMasterKey(
  file: File,
  onStage: (stage: string) => void,
): Promise<MasterKeySummary> {
  onStage("Uploading PDF to the API");
  const form = new FormData();
  form.append("masterPdf", file);

  const accepted = await readJson<{
    jobId: string;
    status: string;
    stage: string;
  }>(
    await fetch(`${API}/master-keys`, { method: "POST", body: form }),
  );
  onStage(accepted.stage);
  const startedAt = Date.now();
  const delay = (milliseconds: number) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  while (true) {
    await delay(1000);
    const status = await readJson<{
      status: string;
      stage: string;
      result: MasterKeySummary | null;
      error: string | null;
    }>(
      await fetch(`${API}/master-keys/imports/${accepted.jobId}`, {
        cache: "no-store",
      }),
    );
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    onStage(
      status.stage.startsWith("Gemini is extracting the answer key")
        ? `${status.stage} (${elapsedSeconds}s elapsed)`
        : status.stage,
    );

    if (status.status === "completed" && status.result) {
      return status.result;
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "Answer-key extraction failed.");
    }
  }
}

export async function evaluatePapers(
  masterKeyId: string,
  studentPdf: File,
  onStage: (stage: string) => void,
): Promise<EvaluationResult> {
  const form = new FormData();
  form.append("masterKeyId", masterKeyId);
  form.append("studentPdf", studentPdf);

  const accepted = await readJson<{ jobId: string }>(
    await fetch(`${API}/assessment-evaluation/start`, {
      method: "POST",
      body: form,
    }),
  );
  const delay = (milliseconds: number) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  while (true) {
    await delay(1200);
    const status = await readJson<EvaluationStatus>(
      await fetch(`${API}/assessment-evaluation/${accepted.jobId}/status`, {
        cache: "no-store",
      }),
    );
    onStage(status.stage);

    if (status.status === "completed" || status.status === "finalized") {
      return readJson<EvaluationResult>(
        await fetch(`${API}/assessment-evaluation/${accepted.jobId}/result`),
      );
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "Evaluation failed.");
    }
  }
}

export async function startBulkEvaluation(
  masterKeyId: string,
  students: Array<StudentUpload & { file: File }>,
): Promise<string> {
  const form = new FormData();
  form.append("masterKeyId", masterKeyId);
  form.append(
    "studentDetails",
    JSON.stringify(
      students.map(({ className, rollNo, subject }) => ({
        className,
        rollNo,
        subject,
      })),
    ),
  );
  students.forEach(({ file }) => form.append("studentPdfs", file, file.name));

  const accepted = await readJson<{ batchId: string }>(
    await fetch(`${API}/assessment-evaluation/bulk/start`, {
      method: "POST",
      body: form,
    }),
  );
  return accepted.batchId;
}

export async function getBulkEvaluation(batchId: string): Promise<BulkEvaluation> {
  return readJson<BulkEvaluation>(
    await fetch(`${API}/assessment-evaluation/batches/${batchId}`, {
      cache: "no-store",
    }),
  );
}

export async function approveBulkEvaluation(
  batchId: string,
): Promise<BulkEvaluation> {
  return readJson<BulkEvaluation>(
    await fetch(`${API}/assessment-evaluation/batches/${batchId}/approve`, {
      method: "POST",
    }),
  );
}

export async function finalizeAllBulkEvaluation(
  batchId: string,
): Promise<BulkEvaluation> {
  const batch = await getBulkEvaluation(batchId);
  const incompleteStudent = batch.students.find(
    (student) =>
      !student.result ||
      (student.status !== "completed" && student.status !== "finalized"),
  );
  if (incompleteStudent) {
    throw new Error(
      `${incompleteStudent.rollNo} has not finished evaluation and cannot be finalized yet.`,
    );
  }

  const pending = batch.students.filter((student) => student.status !== "finalized");
  for (let start = 0; start < pending.length; start += 5) {
    const group = pending.slice(start, start + 5);
    await Promise.all(
      group.map(async (student) => {
        const result = student.result;
        if (!result) {
          throw new Error(`No results are available for roll ${student.rollNo}.`);
        }
        await saveEvaluationMarks(
          student.evaluationId,
          result.questions.map((question) => ({
            questionNumber: question.questionNumber,
            marksAwarded: question.marksAwarded,
            feedback: question.feedback,
          })),
        );
        await finalizeEvaluation(student.evaluationId);
      }),
    );
  }
  return getBulkEvaluation(batchId);
}

export async function cancelBulkEvaluation(
  batchId: string,
): Promise<BulkEvaluation> {
  return readJson<BulkEvaluation>(
    await fetch(`${API}/assessment-evaluation/batches/${batchId}/cancel`, {
      method: "POST",
    }),
  );
}

export async function deleteBulkEvaluation(batchId: string): Promise<boolean> {
  const response = await fetch(`${API}/assessment-evaluation/batches/${batchId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body = await response.text();
    if ((response.status === 404 || response.status === 405) && !body.trim()) {
      return false;
    }
    throw new Error(getErrorMessage(body, response));
  }
  return true;
}

export async function saveEvaluationMarks(
  evaluationId: string,
  questions: Array<{
    questionNumber: string;
    marksAwarded: number;
    feedback: string;
  }>,
): Promise<EvaluationResult> {
  return readJson<EvaluationResult>(
    await fetch(`${API}/assessment-evaluation/${evaluationId}/marks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions }),
    }),
  );
}

export async function finalizeEvaluation(
  evaluationId: string,
): Promise<EvaluationResult> {
  return readJson<EvaluationResult>(
    await fetch(`${API}/assessment-evaluation/${evaluationId}/finalize`, {
      method: "POST",
    }),
  );
}

export async function discardStudentApproval(
  evaluationId: string,
): Promise<EvaluationResult> {
  return readJson<EvaluationResult>(
    await fetch(`${API}/assessment-evaluation/${evaluationId}/unapprove`, {
      method: "POST",
    }),
  );
}
