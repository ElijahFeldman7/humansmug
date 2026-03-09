import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TERAC_BASE = "https://terac.com/api/external/v1";

function teracHeaders() {
  const apiKey = process.env.TERAC_API_KEY;
  if (!apiKey) throw new Error("TERAC_API_KEY is missing");
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

type TeracTask = {
  id: string;
  opportunityId?: string;
  quoteId?: string;
  status: "pending" | "quoted" | "active" | "completed" | "failed";
  entities: Array<{
    name: string;
    category: string;
    desc: string;
    edgeCount: number;
    centrality: number;
  }>;
  createdAt: string;
  submissions?: Array<{
    submittedAt: string;
    findings: string;
  }>;
  totalCost?: number;
};

// In-memory store (would be a DB in production)
const taskStore = new Map<string, TeracTask>();

function generateId() {
  return `osint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// POST — create a new OSINT task or analyze graph for thin entities
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: "analyze" | "create" | "poll" | "fetch-submissions" | "list" | "merge";
      // analyze action
      nodes?: Array<{ name: string; category: string; desc: string; descs?: string[] }>;
      edges?: Array<{ source: string; target: string; label: string; strength: number }>;
      centrality?: Record<string, number>;
      // create action
      entities?: Array<{
        name: string;
        category: string;
        desc: string;
        edgeCount: number;
        centrality: number;
      }>;
      taskType?: "osint" | "cross-link";
      // poll / fetch-submissions / merge
      taskId?: string;
    };

    const action = body.action;

    if (action === "analyze") {
      return handleAnalyze(body);
    }

    if (action === "create") {
      return await handleCreate(body, request);
    }

    if (action === "poll") {
      return await handlePoll(body);
    }

    if (action === "fetch-submissions") {
      return await handleFetchSubmissions(body);
    }

    if (action === "list") {
      return handleList();
    }

    if (action === "merge") {
      return handleMerge(body);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Analyze graph to find entities that need OSINT enrichment
function handleAnalyze(body: {
  nodes?: Array<{ name: string; category: string; desc: string; descs?: string[] }>;
  edges?: Array<{ source: string; target: string; label: string; strength: number }>;
  centrality?: Record<string, number>;
}) {
  const nodes = body.nodes || [];
  const edges = body.edges || [];
  const centrality = body.centrality || {};

  // Count edges per node
  const edgeCount: Record<string, number> = {};
  for (const node of nodes) {
    edgeCount[node.name] = 0;
  }
  for (const edge of edges) {
    edgeCount[edge.source] = (edgeCount[edge.source] || 0) + 1;
    edgeCount[edge.target] = (edgeCount[edge.target] || 0) + 1;
  }

  // Score each entity for "thinness" — high score = needs more info
  const scored = nodes.map((node) => {
    const ec = edgeCount[node.name] || 0;
    const cent = centrality[node.name] || 0;
    const descLength = (node.desc || "").length + (node.descs || []).join("").length;
    const descCount = (node.descs || []).length || (node.desc ? 1 : 0);

    // Thinness factors:
    // - Few edges (isolated) → high thinness
    // - Short/missing description → high thinness
    // - High centrality but sparse info → very high thinness (important but unknown)
    // - Skip PERSON category with initials-only names (too vague for OSINT)
    const isVaguePerson = node.category === "PERSON" && /^[A-Z]\.[A-Z]?\.?$/.test(node.name.trim());
    if (isVaguePerson) return null;

    let thinness = 0;
    thinness += Math.max(0, 3 - ec) * 2; // 0-6 points for few edges
    thinness += Math.max(0, 50 - descLength) / 10; // 0-5 points for short desc
    thinness += descCount <= 1 ? 2 : 0; // 2 points for single description
    thinness += cent > 0.1 ? cent * 10 : 0; // bonus for high centrality nodes

    return {
      name: node.name,
      category: node.category,
      desc: node.desc || "",
      edgeCount: ec,
      centrality: cent,
      thinness,
    };
  }).filter((n): n is NonNullable<typeof n> => n !== null);

  // Sort by thinness descending, take top candidates
  scored.sort((a, b) => b.thinness - a.thinness);
  const candidates = scored.filter((s) => s.thinness > 3).slice(0, 15);

  return NextResponse.json({ candidates });
}

// Create a Terac opportunity for OSINT enrichment
async function handleCreate(
  body: {
    entities?: Array<{
      name: string;
      category: string;
      desc: string;
      edgeCount: number;
      centrality: number;
    }>;
    taskType?: "osint" | "cross-link";
  },
  request: Request,
) {
  const entities = body.entities || [];
  const taskType = body.taskType || "osint";

  if (entities.length === 0) {
    return NextResponse.json({ error: "No entities provided" }, { status: 400 });
  }

  const entityListText = entities
    .map((e) => `- ${e.name} (${e.category}): ${e.desc || "No description"}`)
    .join("\n");

  const taskDescription =
    taskType === "osint"
      ? `OSINT Research Task: Investigate the following entities from a legal case knowledge graph related to human smuggling networks. For each entity, search public records, court documents, news articles, and other open sources to find additional facts, relationships, aliases, and context.\n\nEntities to research:\n${entityListText}\n\nFor each entity, provide:\n1. Any additional facts or context found\n2. New relationships to other entities discovered\n3. Source URLs for your findings\n4. Confidence level (high/medium/low) for each finding`
      : `Cross-Document Link Discovery: These entity clusters appear disconnected in our knowledge graph. Search public records and news to find connections between them.\n\nEntities:\n${entityListText}`;

  const panelDescription =
    "OSINT researchers, legal analysts, or investigators with experience in public records search, court document analysis, and open-source intelligence gathering.";

  const taskId = generateId();
  const origin = new URL(request.url).origin;
  const dashboardUrl = `${origin}/osint/${taskId}`;

  // Step 1: Create quote
  let quoteId: string | undefined;
  let totalCost: number | undefined;
  try {
    const quoteRes = await fetch(`${TERAC_BASE}/quote`, {
      method: "POST",
      headers: teracHeaders(),
      body: JSON.stringify({
        taskDescription: `${taskDescription}\n\nWorker Dashboard: ${dashboardUrl}`,
        panelDescription,
        timelineHours: 48,
        submissionCount: 3,
      }),
    });

    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      throw new Error(`Terac quote failed: ${err}`);
    }

    const quote = (await quoteRes.json()) as {
      quoteId: string;
      totalCost: number;
    };
    quoteId = quote.quoteId;
    totalCost = quote.totalCost;
  } catch (err) {
    // If Terac is unavailable, create task in demo mode
    const task: TeracTask = {
      id: taskId,
      status: "pending",
      entities,
      createdAt: new Date().toISOString(),
      totalCost: 0,
    };
    taskStore.set(taskId, task);

    return NextResponse.json({
      taskId,
      status: "pending",
      dashboardUrl,
      note: "Terac API unavailable — task created in demo mode",
      error: err instanceof Error ? err.message : "Terac unavailable",
    });
  }

  // Step 2: Launch opportunity
  let opportunityId: string | undefined;
  try {
    const oppRes = await fetch(`${TERAC_BASE}/opportunities`, {
      method: "POST",
      headers: teracHeaders(),
      body: JSON.stringify({
        quoteId,
        name: `OSINT Enrichment: ${entities.map((e) => e.name).join(", ").slice(0, 80)}`,
      }),
    });

    if (!oppRes.ok) {
      throw new Error(`Terac opportunity creation failed`);
    }

    const opp = (await oppRes.json()) as { opportunityId: string };
    opportunityId = opp.opportunityId;
  } catch {
    // Store with quote but no opportunity
    const task: TeracTask = {
      id: taskId,
      quoteId,
      status: "quoted",
      entities,
      createdAt: new Date().toISOString(),
      totalCost,
    };
    taskStore.set(taskId, task);

    return NextResponse.json({
      taskId,
      status: "quoted",
      quoteId,
      totalCost,
      dashboardUrl,
    });
  }

  // Store task
  const task: TeracTask = {
    id: taskId,
    quoteId,
    opportunityId,
    status: "active",
    entities,
    createdAt: new Date().toISOString(),
    totalCost,
  };
  taskStore.set(taskId, task);

  return NextResponse.json({
    taskId,
    status: "active",
    opportunityId,
    quoteId,
    totalCost,
    dashboardUrl,
  });
}

// Poll Terac opportunity status
async function handlePoll(body: { taskId?: string }) {
  const taskId = body.taskId;
  if (!taskId) {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.opportunityId) {
    return NextResponse.json({ task });
  }

  try {
    const statusRes = await fetch(
      `${TERAC_BASE}/opportunities/${task.opportunityId}`,
      { headers: teracHeaders() },
    );

    if (statusRes.ok) {
      const status = (await statusRes.json()) as { status: string };
      if (status.status === "ACTIVE") task.status = "active";
      if (status.status === "COMPLETED") task.status = "completed";
      taskStore.set(taskId, task);
    }
  } catch {
    // ignore poll errors
  }

  return NextResponse.json({ task });
}

// Fetch submissions from Terac
async function handleFetchSubmissions(body: { taskId?: string }) {
  const taskId = body.taskId;
  if (!taskId) {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.opportunityId) {
    return NextResponse.json({ task });
  }

  try {
    const subRes = await fetch(
      `${TERAC_BASE}/opportunities/${task.opportunityId}/submissions`,
      { headers: teracHeaders() },
    );

    if (subRes.ok) {
      const subs = (await subRes.json()) as Array<{
        submittedAt: string;
        data?: { findings?: string };
      }>;
      task.submissions = subs.map((s) => ({
        submittedAt: s.submittedAt,
        findings: s.data?.findings || JSON.stringify(s),
      }));
      task.status = "completed";
      taskStore.set(taskId, task);
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ task });
}

// List all tasks
function handleList() {
  const tasks = [...taskStore.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return NextResponse.json({ tasks });
}

// Convert OSINT findings into tuples for graph merging
function handleMerge(body: { taskId?: string }) {
  const taskId = body.taskId;
  if (!taskId) {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Return the submissions as-is for the frontend to process
  return NextResponse.json({
    task,
    entities: task.entities,
    submissions: task.submissions || [],
  });
}
