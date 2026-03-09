"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type EntityInfo = {
  name: string;
  category: string;
  desc: string;
  edgeCount: number;
  centrality: number;
};

type Finding = {
  entityName: string;
  fact: string;
  sourceUrl: string;
  confidence: "high" | "medium" | "low";
  newRelationships: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  PERSON: "#ff6b6b",
  LOCATION: "#5b8dff",
  ORGANIZATION: "#ffd93d",
  MEANS_OF_TRANSPORTATION: "#4af0b0",
  ROUTES: "#c084fc",
  DEFAULT: "#6272a4",
};

function getCategoryColor(cat: string) {
  return CATEGORY_COLORS[cat.toUpperCase()] || CATEGORY_COLORS.DEFAULT;
}

export default function OsintDashboard() {
  const params = useParams();
  const taskId = params.taskId as string;

  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/terac", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", taskId }),
        });
        const data = (await res.json()) as {
          task?: { entities: EntityInfo[] };
          error?: string;
        };
        if (data.error) {
          setError(data.error);
        } else if (data.task?.entities) {
          setEntities(data.task.entities);
          setFindings(
            data.task.entities.map((e) => ({
              entityName: e.name,
              fact: "",
              sourceUrl: "",
              confidence: "medium" as const,
              newRelationships: "",
            })),
          );
        }
      } catch {
        setError("Failed to load task");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [taskId]);

  const updateFinding = useCallback(
    (idx: number, field: keyof Finding, value: string) => {
      setFindings((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        return next;
      });
    },
    [],
  );

  const addFinding = useCallback(() => {
    setFindings((prev) => [
      ...prev,
      {
        entityName: entities[0]?.name || "",
        fact: "",
        sourceUrl: "",
        confidence: "medium" as const,
        newRelationships: "",
      },
    ]);
  }, [entities]);

  const handleSubmit = async () => {
    const filled = findings.filter((f) => f.fact.trim());
    if (filled.length === 0) return;
    setSubmitting(true);

    try {
      // In production this would submit to Terac's submission endpoint
      // For the hackathon, we store locally via our API
      await fetch("/api/terac/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, findings: filled }),
      });
      setSubmitted(true);
    } catch {
      setError("Failed to submit findings");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14]">
        <div className="flex items-center gap-2 text-[#6272a4]">
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:0ms]" />
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:150ms]" />
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:300ms]" />
          <span className="ml-2">Loading task...</span>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14]">
        <div className="max-w-md rounded-2xl border border-[#2a3347] bg-[#141820] p-8 text-center">
          <div className="mb-3 text-4xl">&#10003;</div>
          <h2 className="mb-2 text-xl font-bold text-[#4af0b0]">Findings Submitted</h2>
          <p className="text-[0.82rem] text-[#6272a4]">
            Thank you for your OSINT research. Your findings will be reviewed and merged into the knowledge graph.
          </p>
        </div>
      </div>
    );
  }

  if (error && entities.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14]">
        <div className="max-w-md rounded-2xl border border-[#ff6b6b]/30 bg-[#141820] p-8 text-center">
          <h2 className="mb-2 text-lg font-bold text-[#ff6b6b]">Error</h2>
          <p className="text-[0.82rem] text-[#6272a4]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0d0f14] text-[#cdd6f4]">
      {/* Header */}
      <header className="border-b border-[#2a3347] bg-[#141820] px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full border-2 border-[#4af0b0] bg-[#102018] text-xs font-bold text-[#4af0b0]">
              OS
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                OSINT Research Task
              </h1>
              <p className="text-[0.68rem] text-[#6272a4]">
                Crime-KG Intelligence Enrichment &middot; Task {taskId.slice(-8)}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Instructions */}
        <div className="mb-6 rounded-xl border border-[#2a3347] bg-[#141820] p-5">
          <h2 className="mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-[#4af0b0]">
            Instructions
          </h2>
          <p className="text-[0.78rem] leading-relaxed text-[#9aa6cf]">
            Below are entities from a criminal network knowledge graph that need additional intelligence.
            For each entity, search public records, court documents (PACER), news articles, and other
            open sources. Document any new facts, relationships, aliases, or context you discover.
            Include source URLs for verification.
          </p>
        </div>

        {/* Entity Cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entities.map((entity) => (
            <div
              key={entity.name}
              className="rounded-xl border border-[#2a3347] bg-[#141820] p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <div
                  className="size-2.5 rounded-full"
                  style={{ background: getCategoryColor(entity.category) }}
                />
                <span className="text-[0.78rem] font-bold">{entity.name}</span>
              </div>
              <div
                className="mb-2 inline-block rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.1em]"
                style={{
                  color: getCategoryColor(entity.category),
                  background: getCategoryColor(entity.category) + "15",
                  border: `1px solid ${getCategoryColor(entity.category)}30`,
                }}
              >
                {entity.category}
              </div>
              <p className="mb-2 text-[0.7rem] leading-relaxed text-[#9aa6cf]">
                {entity.desc || "No description available"}
              </p>
              <div className="flex gap-3 text-[0.6rem] text-[#6272a4]">
                <span>{entity.edgeCount} connections</span>
                {entity.centrality > 0 && (
                  <span>centrality: {entity.centrality.toFixed(3)}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Findings Form */}
        <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-5">
          <h2 className="mb-4 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-[#4af0b0]">
            Your Findings
          </h2>

          <div className="space-y-4">
            {findings.map((finding, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-[#2a3347] bg-[#0d0f14] p-4"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#6272a4]">
                    Finding {idx + 1}
                  </span>
                  <select
                    value={finding.entityName}
                    onChange={(e) => updateFinding(idx, "entityName", e.target.value)}
                    className="rounded-md border border-[#2a3347] bg-[#141820] px-2 py-1 text-[0.7rem] text-[#cdd6f4] outline-none focus:border-[#5b8dff]"
                  >
                    {entities.map((e) => (
                      <option key={e.name} value={e.name}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={finding.confidence}
                    onChange={(e) => updateFinding(idx, "confidence", e.target.value)}
                    className="ml-auto rounded-md border border-[#2a3347] bg-[#141820] px-2 py-1 text-[0.7rem] text-[#cdd6f4] outline-none focus:border-[#5b8dff]"
                  >
                    <option value="high">High confidence</option>
                    <option value="medium">Medium confidence</option>
                    <option value="low">Low confidence</option>
                  </select>
                </div>

                <textarea
                  value={finding.fact}
                  onChange={(e) => updateFinding(idx, "fact", e.target.value)}
                  placeholder="Describe what you found about this entity..."
                  rows={3}
                  className="mb-2 w-full resize-none rounded-md border border-[#2a3347] bg-[#141820] px-3 py-2 text-[0.75rem] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/60 focus:border-[#5b8dff]"
                />

                <input
                  value={finding.sourceUrl}
                  onChange={(e) => updateFinding(idx, "sourceUrl", e.target.value)}
                  placeholder="Source URL (court record, news article, etc.)"
                  className="mb-2 w-full rounded-md border border-[#2a3347] bg-[#141820] px-3 py-2 text-[0.75rem] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/60 focus:border-[#5b8dff]"
                />

                <textarea
                  value={finding.newRelationships}
                  onChange={(e) => updateFinding(idx, "newRelationships", e.target.value)}
                  placeholder="New relationships discovered (e.g., 'Connected to CARTEL X through intermediary Y')"
                  rows={2}
                  className="w-full resize-none rounded-md border border-[#2a3347] bg-[#141820] px-3 py-2 text-[0.75rem] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/60 focus:border-[#5b8dff]"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={addFinding}
              className="rounded-lg border border-[#2a3347] bg-[#1c2230] px-4 py-2 text-[0.72rem] text-[#6272a4] transition hover:border-[#5b8dff] hover:text-[#5b8dff]"
            >
              + Add Finding
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || findings.every((f) => !f.fact.trim())}
              className="ml-auto rounded-lg border border-[#4af0b0] bg-[#102018] px-6 py-2 text-[0.72rem] font-semibold text-[#4af0b0] transition hover:bg-[#143020] disabled:opacity-40"
            >
              {submitting ? "Submitting..." : "Submit Findings"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-[#ff6b6b]/30 bg-[#0d0f14] px-4 py-2 text-[0.72rem] text-[#ff6b6b]">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
