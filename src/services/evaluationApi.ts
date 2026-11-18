import type {
  EvaluationResult,
  EvaluationStatus,
  MasterKeySummary,
} from "../types";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001/api";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error ?? "The request failed.");
  }
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
