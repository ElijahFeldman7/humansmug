import { NextResponse } from "next/server";

type OllamaGenerateResponse = {
  response?: string;
  error?: string;
};

const DEFAULT_MODEL = "2028efeldman/llama-finetuned";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

const buildPrompt = (text: string) => {
  return `You convert narrative text into tuple-based knowledge graph records.

Output rules:
- Output only tuple records and delimiters, no prose.
- Use this exact structure for entities:
("entity"{tuple_delimiter}<NAME>{tuple_delimiter}<CATEGORY>{tuple_delimiter}<DESCRIPTION>)
- Use this exact structure for relationships:
("relationship"{tuple_delimiter}<SOURCE>{tuple_delimiter}<TARGET>{tuple_delimiter}<RELATIONSHIP_DESCRIPTION>{tuple_delimiter}<STRENGTH_1_TO_10>)
- Separate records using {record_delimiter}
- End output with {completion_delimiter}
- Categories should be uppercase identifiers when possible.
- Include enough entities and relationships to represent the text clearly.

Text:
${text}`;
};

const sanitizeModelOutput = (output: string) => {
  const withoutFences = output.replace(/```[\s\S]*?```/g, "").trim();
  if (withoutFences.includes("{completion_delimiter}")) {
    return withoutFences;
  }
  return `${withoutFences}\n{record_delimiter}\n{completion_delimiter}`;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim() || "";

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    const ollamaUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;

    const ollamaResponse = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(text),
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
      cache: "no-store",
    });

    if (!ollamaResponse.ok) {
      const errText = await ollamaResponse.text();
      return NextResponse.json(
        {
          error: `Ollama request failed: ${ollamaResponse.status} ${errText}`,
        },
        { status: 502 },
      );
    }

    const payload = (await ollamaResponse.json()) as OllamaGenerateResponse;
    const output = sanitizeModelOutput(payload.response || "");

    if (!output.trim()) {
      return NextResponse.json({ error: "Model returned empty output" }, { status: 502 });
    }

    return NextResponse.json({ output, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Failed to generate tuples via Ollama: ${message}`,
      },
      { status: 500 },
    );
  }
}
