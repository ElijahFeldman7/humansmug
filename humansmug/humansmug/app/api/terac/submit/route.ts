import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Finding = {
  entityName: string;
  fact: string;
  sourceUrl: string;
  confidence: "high" | "medium" | "low";
  newRelationships: string;
};

type StoredSubmission = {
  taskId: string;
  findings: Finding[];
  submittedAt: string;
};

// In-memory store (shared with main route in production via DB)
const submissionStore = new Map<string, StoredSubmission[]>();

export function getSubmissions(taskId: string): StoredSubmission[] {
  return submissionStore.get(taskId) || [];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId?: string;
      findings?: Finding[];
    };

    const taskId = body.taskId;
    const findings = body.findings || [];

    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    if (findings.length === 0) {
      return NextResponse.json({ error: "No findings provided" }, { status: 400 });
    }

    const submission: StoredSubmission = {
      taskId,
      findings,
      submittedAt: new Date().toISOString(),
    };

    const existing = submissionStore.get(taskId) || [];
    existing.push(submission);
    submissionStore.set(taskId, existing);

    return NextResponse.json({
      success: true,
      submissionCount: existing.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
