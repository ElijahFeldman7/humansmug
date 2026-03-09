import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

function buildPrompt(name: string, descriptions: string[], nodeNames: string[]) {
  const descLines = descriptions.map((d, i) => `(${i + 1}) ${d}`);
  return `You are summarizing a single entity in a knowledge graph.
Use ONLY the provided descriptions. Do NOT add external facts or new words.
If there is only one description, return it verbatim.
If there are multiple descriptions, merge them into 1-2 sentences by reusing exact phrases from the inputs.
Do NOT introduce any new information.

If you reference any other node from the list, link it exactly like:
[NODE:Exact Name](node:Exact Name)
Otherwise, do not create links.

Entity: ${name}
Known nodes: ${nodeNames.join(", ")}

Descriptions:
${descLines.join("\n")}
`;
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isSummaryStrict(summary: string, descriptions: string[]) {
  const summaryWords = new Set(normalizeWords(summary));
  const inputWords = new Set(normalizeWords(descriptions.join(" ")));
  for (const word of summaryWords) {
    if (!inputWords.has(word)) {
      return false;
    }
  }
  return true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      descriptions?: string[];
      nodeNames?: string[];
    };
    const name = String(body.name || "").trim();
    const descriptions = Array.isArray(body.descriptions) ? body.descriptions : [];
    const nodeNames = Array.isArray(body.nodeNames) ? body.nodeNames : [];

    if (!name || descriptions.length === 0) {
      return NextResponse.json({ error: "Missing name or descriptions" }, { status: 400 });
    }

    const prompt = buildPrompt(name, descriptions, nodeNames);
    const output = await callGemini(prompt);
    const trimmed = output.trim();
    const fallback = descriptions.join(" | ");
    if (!trimmed) {
      return NextResponse.json({ output: fallback });
    }
    if (!isSummaryStrict(trimmed, descriptions)) {
      return NextResponse.json({ output: fallback });
    }
    return NextResponse.json({ output: trimmed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
