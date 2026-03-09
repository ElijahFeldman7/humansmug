import { NextResponse } from "next/server";

export const runtime = "nodejs";

type GraphNode = {
  name: string;
  category: string;
  desc: string;
};

type GraphEdge = {
  id?: string;
  source: string;
  target: string;
  label: string;
  strength: number;
  evidence?: string;
};

type CentralityScores = Record<string, number>;

type AnalyticsData = {
  centrality?: {
    degree?: CentralityScores;
    closeness?: CentralityScores;
    eigenvector?: CentralityScores;
    betweenness?: CentralityScores;
  };
  communities?: Array<{
    groupIndex: number;
    nodes: string[];
    size: number;
  }>;
  edgeStats?: {
    mean: number;
    std: number;
    outlierThreshold: number;
    outliers: Array<{
      source: string;
      target: string;
      label: string;
      strength: number;
      zScore: number;
    }>;
  };
};

async function callGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: controller.signal,
    },
  ).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini error ${response.status}: ${err}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function formatTopN(scores: CentralityScores, n: number): string {
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, score], i) => `  ${i + 1}. ${name}: ${score.toFixed(4)}`)
    .join("\n");
}

function buildAnalyticsSection(analytics: AnalyticsData): string {
  const sections: string[] = [];

  if (analytics.centrality) {
    const c = analytics.centrality;
    const parts: string[] = [];

    if (c.degree && Object.keys(c.degree).length > 0) {
      parts.push(`Degree Centrality (direct activity — how many connections a node has):\n${formatTopN(c.degree, 10)}`);
    }
    if (c.closeness && Object.keys(c.closeness).length > 0) {
      parts.push(`Closeness Centrality (strategic access — how quickly a node can reach all others):\n${formatTopN(c.closeness, 10)}`);
    }
    if (c.eigenvector && Object.keys(c.eigenvector).length > 0) {
      parts.push(`Eigenvector Centrality (influence — connection to other well-connected nodes):\n${formatTopN(c.eigenvector, 10)}`);
    }
    if (c.betweenness && Object.keys(c.betweenness).length > 0) {
      parts.push(`Betweenness Centrality (chokepoints — nodes that bridge separate clusters):\n${formatTopN(c.betweenness, 10)}`);
    }

    if (parts.length > 0) {
      sections.push("NODE RANKINGS (top 10 per metric):\n" + parts.join("\n\n"));
    }
  }

  if (analytics.communities && analytics.communities.length > 0) {
    const communityLines = analytics.communities.map((c) =>
      `  Group ${c.groupIndex} (${c.size} nodes): ${c.nodes.join(", ")}`,
    );
    sections.push("COMMUNITY/SUBGROUP DETECTION (Louvain algorithm):\n" + communityLines.join("\n"));
  }

  if (analytics.edgeStats) {
    const s = analytics.edgeStats;
    let statsBlock = `EDGE STATISTICS:\n  Mean strength: ${s.mean.toFixed(2)}\n  Std deviation: ${s.std.toFixed(2)}\n  Outlier threshold (mean + 1.25*std): ${s.outlierThreshold.toFixed(2)}`;

    if (s.outliers.length > 0) {
      const outlierLines = s.outliers.map((o) =>
        `  - ${o.source} -> ${o.target} | ${o.label} | strength=${o.strength} | z-score=${o.zScore.toFixed(2)}`,
      );
      statsBlock += `\n  Statistical outlier relationships (unusually strong signals):\n${outlierLines.join("\n")}`;
    }

    sections.push(statsBlock);
  }

  return sections.join("\n\n");
}

function buildPrompt(message: string, nodes: GraphNode[], edges: GraphEdge[], analytics?: AnalyticsData) {
  const nodeLines = nodes.map((n) => {
    const desc = n.desc ? n.desc.replace(/\s+/g, " ").trim() : "";
    return `- ${n.name} | ${n.category} | ${desc}`;
  });
  const edgeLines = edges.map((e) => {
    const strength = Number.isFinite(e.strength) ? e.strength : 0;
    const evidence = e.evidence ? ` | evidence: ${e.evidence}` : "";
    return `- ${e.source} -> ${e.target} | ${e.label} | ${strength}${evidence}`;
  });

  const analyticsBlock = analytics ? buildAnalyticsSection(analytics) : "";

  return `You are a strict analysis assistant for a knowledge graph. You answer questions using ONLY the graph data and computed analytics below.

HARD RULES:
1. Use ONLY the nodes, edges, and analytics listed below. Do NOT invent, infer, or add any entity, relationship, or fact not explicitly present.
2. Do NOT use outside knowledge, background information, or common sense to fill gaps. If the graph doesn't contain it, it doesn't exist for you.
3. If the answer is not supported by the graph data, respond exactly: "Not found in the current graph."
4. Be concise and direct. Do not over-explain or add filler. Short bullet points are preferred over paragraphs. Only elaborate if the user explicitly asks for detail.
5. Every time you mention an entity by name, you MUST wrap it as a node link. No exceptions.
6. When describing a relationship, you MUST wrap it as an edge link. No exceptions.

ANALYTICS CAPABILITIES:
You have access to pre-computed graph analytics. Use them to answer questions about:
- **Most important/central/influential nodes**: Use centrality rankings. Degree = most connections. Closeness = best strategic access. Eigenvector = most influential (connected to other important nodes). Betweenness = key bridges/chokepoints between clusters.
- **Clusters/groups/communities**: Use community detection data to identify which nodes form tight subgroups.
- **Anomalous/unusual relationships**: Use edge statistics and outliers to identify statistically significant connections (high z-scores indicate unusually strong signals).
- **Network structure**: Combine centrality + communities to describe the overall network topology.

When answering analytical questions, CITE THE SPECIFIC SCORES. For example: "SAI DESHPANDE has the highest betweenness centrality (0.4523), making them the key bridge between clusters."

LINK FORMAT — follow this EXACTLY:
- Node link: [NODE:Exact Name](node:Exact Name)
  Example: [NODE:SAI DESHPANDE](node:SAI DESHPANDE)
- Edge link: [EDGE:Source -> Target | Label](edge:Source|Target|Label)
  Example: [EDGE:SAI DESHPANDE -> CARTEL NETWORK | Works under cartel direction](edge:SAI DESHPANDE|CARTEL NETWORK|Works under cartel direction)

CRITICAL LINK RULES:
- The name inside the link MUST exactly match a node name from the list below. Copy-paste it.
- Do NOT put the category in the link. Wrong: [BORDER WALL](means_of_transportation:BORDER WALL). Right: [NODE:BORDER WALL](node:BORDER WALL).
- The prefix in parentheses must always be "node:" for nodes and "edge:" for edges. Never use category names as prefixes.
- Do NOT invent link formats. Use only the two formats shown above.

Respond in Markdown.

Nodes (name | category | description):
${nodeLines.join("\n")}

Edges (source -> target | label | strength | evidence):
${edgeLines.join("\n")}
${analyticsBlock ? `\n${analyticsBlock}` : ""}

User question:
${message}
`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      nodes?: GraphNode[];
      edges?: GraphEdge[];
      analytics?: AnalyticsData;
    };
    const message = String(body.message || "").trim();
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];
    const analytics = body.analytics || undefined;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (!nodes.length && !edges.length) {
      return NextResponse.json({
        output: "No graph is loaded yet. Render a graph first, then ask me about it.",
      });
    }

    const prompt = buildPrompt(message, nodes, edges, analytics);
    const output = await callGemini(prompt);
    return NextResponse.json({ output: output || "No response returned." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
