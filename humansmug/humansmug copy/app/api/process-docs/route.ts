import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import Papa from "papaparse";

export const runtime = "nodejs";

const ENTITY_TYPES = [
  "PERSON",
  "LOCATION",
  "ORGANIZATION",
  "MEANS_OF_TRANSPORTATION",
  "MEANS_OF_COMMUNICATION",
  "ROUTES",
  "SMUGGLED_ITEMS",
] as const;

const EXTRACTION_PROMPT = `
Goal
You are an expert in Named Entity and Relationship Extraction (NER-RE) for legal case documents related to human
smuggling. Your task is to extract only the specified entity types [entity_types] and explicit relationships between
them, without inference or completion. These outputs will be used to construct a Knowledge Graph for analyzing
smuggling networks. You will receive entity definitions, input text, and structured examples—study them carefully
before extraction to ensure strict factual accuracy.
Do not extract entities corresponding to governmental organizations or entities closely related to the trial, criminal
law and law procedures (e.g., jury, government, court, prosecution, etc.). These are out of scope.

Entity Type Definitions
1. PERSON: Any individual’s name, including smugglers, agents, and undocumented migrants.
2. LOCATION: Geographical areas (e.g., city, state, country).
3. ORGANIZATION: Smuggling rings, drug cartels, and other formal groups.
4. MEANS_OF_TRANSPORTATION: Vehicles like car, truck, 18-wheeler.
5. MEANS_OF_COMMUNICATION: Tools like phone, WhatsApp.
6. ROUTES: Roads, highways, or freeways used in smuggling.
7. SMUGGLED_ITEMS: Goods like drugs, weapons, or undocumented aliens.

Steps
(1) Entity Extraction: Extract only explicitly stated entities of type [entity_types]. Do not infer or complete
missing information. For each, extract the following fields: entity_name — Capitalized name as it appears.
entity_type — One of: [entity_types]
entity_description — Detailed description of the entity’s role or attributes.
Do not extract any entities related to government or legal proceedings (e.g., court, jury, prosecution, law
enforcement, etc.).
Extract entity types in the following order:
PERSON: If a person appears with a title (e.g., “Agent R.”), extract only the full name (e.g., “R.”) as the entity_name
and include the title in entity_description.
LOCATION: Combine city and state into a single entity (e.g., Laredo, Texas).
MEANS_OF_TRANSPORTATION, MEANS_OF_COMMUNICATION, ROUTES, SMUGGLED_ITEMS,
ORGANIZATION: Extract as relevant.
Format each entity as:
("entity"{tuple_delimiter}entity_name{tuple_delimiter}
entity_type{tuple_delimiter}entity_description")
(2) Relationship Extraction: From the entities identified, extract all clearly stated relationships, even if embedded
in complex sentences.
For each relationship, extract:
source_entity — Source entity from step 1
target_entity — Target entity from step 1
relationship_description — Explanation of the connection
relationship_strength — Score between 0–10:
• 0–3 (Weak): Indirect or uncertain (e.g., “may have. . . ”)
• 4–6 (Moderate): Explicit but lacks strong context
• 7–10 (Strong): Clear, direct, and contextually supported
Format each relationship as:
("relationship"{tuple_delimiter}source_entity{tuple_delimiter}
target_entity{tuple_delimiter}relationship_description{tuple_delimiter}
relationship_strength")
(3) Filter Government Entities: If any government-related entities or relationships are mistakenly extracted,
remove them.
(4) Output Format: Return all extracted entities and relationships as a single list using {record_delimiter} as
the separator.
(5) Completion Token: End the output with: {completion_delimiter}
`;

const COREF_PROMPT = `
You are consolidating entity references in a knowledge graph.
Given the tuple list below, merge entities that clearly refer to the same real-world entity.
Only merge when it is explicitly obvious (e.g., case differences, abbreviations, repeated full names).
Do not invent or infer new entities or relationships. Preserve all relationships and rewrite them using the merged names.
Output only tuples in the same format using {record_delimiter} and end with {completion_delimiter}.
`;

function csvEscape(value: string | null | undefined) {
  const safe = String(value ?? "");
  const needsQuotes = /[",\n\r]/.test(safe);
  const escaped = safe.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function splitSentences(text?: string) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const sentenceEndings = /(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\!|\?)\s+(?=[A-Z"])/g;
  return normalized ? normalized.split(sentenceEndings).map((s) => s.trim()).filter(Boolean) : [];
}

function chunkSentences(sentences: string[], blurbSize = 2) {
  if (!sentences.length) return [];
  const blurbs: string[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const chunk = sentences.slice(i, i + blurbSize);
    const blurb = chunk.join(" ").trim();
    if (blurb) blurbs.push(blurb);
  }
  return blurbs;
}

function isRelevant(blurb: string) {
  const words = blurb.trim().split(/\s+/);
  if (words.length < 6) return false;
  const alphaChars = [...blurb].filter((c) => /[A-Za-z]/.test(c)).length;
  if (alphaChars / Math.max(blurb.length, 1) < 0.4) return false;
  const upperChars = [...blurb].filter((c) => /[A-Z]/.test(c)).length;
  if (alphaChars > 0 && upperChars / alphaChars > 0.7) return false;
  return true;
}

async function callGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
        generationConfig: { temperature: 0.1 },
      }),
    },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini error ${response.status}: ${err}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

async function extractTuples(blurb: string) {
  const prompt = `${EXTRACTION_PROMPT}\n\nentity_types: ${ENTITY_TYPES.join(", ")}\n\nInput:\n${blurb}\n\nOutput:\n`;
  return callGemini(prompt);
}

async function corefTuples(allTuples: string) {
  const prompt = `${COREF_PROMPT}\n\nTuples:\n${allTuples}\n`;
  return callGemini(prompt);
}

function normalizeName(value?: string) {
  const safe = String(value || "");
  return safe.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function mergeTuplesLocally(raw: string) {
  const norm = String(raw || "")
    .replace(/""/g, '"')
    .replace(/\{tuple_delimiter\}/g, "\x01")
    .replace(/\{record_delimiter\}/g, "\n")
    .replace(/\{completion_delimiter\}/g, "");
  const entityMap = new Map<string, string>();
  const entityMeta = new Map<string, { type: string; desc: string }>();
  const entityLines: string[] = [];
  const relationshipLines: string[] = [];
  const lines = norm.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const buildEntityLine = (name: string, type: string, desc: string, separator: string) =>
    `("entity"${separator}${name}${separator}${type}${separator}${desc})`;
  const buildRelLine = (
    source: string,
    target: string,
    label: string,
    strength: string,
    separator: string,
  ) => `("relationship"${separator}${source}${separator}${target}${separator}${label}${separator}${strength})`;

  for (const line of lines) {
    const normalizedLine = line.replace(/""/g, '"');
    const isEntity = normalizedLine.startsWith('("entity"');
    const isRel = normalizedLine.startsWith('("relationship"');
    if (!isEntity && !isRel) continue;

    const separator = normalizedLine.includes("\x01") ? "\x01" : "|";
    const parts = normalizedLine
      .split(separator)
      .map((p) => String(p ?? "").replace(/^"|"$/g, "").trim());

    if (isEntity) {
      const name = parts[1] || "";
      const type = parts[2] || "DEFAULT";
      const desc = parts.slice(3).join(" ").trim();
      const key = normalizeName(name);
      if (!entityMap.has(key)) {
        entityMap.set(key, name);
        entityMeta.set(key, { type, desc });
        entityLines.push(buildEntityLine(name, type, desc, separator));
      }
      continue;
    }

    if (isRel) {
      relationshipLines.push(normalizedLine);
    }
  }

  const mergedRelationships = relationshipLines.map((line) => {
    const separator = line.includes("\x01") ? "\x01" : "|";
    const parts = line
      .split(separator)
      .map((p) => String(p ?? "").replace(/^"|"$/g, "").trim());
    if (parts.length < 4) return line;
    const sourceKey = normalizeName(parts[1]);
    const targetKey = normalizeName(parts[2]);
    const source = entityMap.get(sourceKey) || parts[1];
    const target = entityMap.get(targetKey) || parts[2];
    const label = parts[3] || "";
    const strength = parts[4] || "5";
    return buildRelLine(source, target, label, strength, separator);
  });

  const merged = [...entityLines, ...mergedRelationships];
  if (!merged.length) {
    return "{completion_delimiter}";
  }
  return merged.join("\n{record_delimiter}\n") + "\n{record_delimiter}\n{completion_delimiter}";
}

function hasValidEntities(raw: string) {
  const norm = String(raw || "")
    .replace(/\{tuple_delimiter\}/g, "\x01")
    .replace(/\{record_delimiter\}/g, "\n")
    .replace(/\{completion_delimiter\}/g, "");
  const lines = norm.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let valid = 0;
  for (const line of lines) {
    if (!line.startsWith('("entity"')) continue;
    const separator = line.includes("\x01") ? "\x01" : "|";
    const parts = line
      .split(separator)
      .map((p) => String(p ?? "").replace(/^"|"$/g, "").trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      valid += 1;
      if (valid >= 2) return true;
    }
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter(Boolean) as File[];
    const blurbSize = Number(form.get("blurbSize") || 2);
    const applyFilter = String(form.get("applyFilter") || "true") !== "false";

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const rows: Array<{ doc_id: string; sentence_blurb: string }> = [];
    const tupleRows: Array<{ doc_id: string; sentence_blurb: string; ner_re_output: string }> = [];

    for (const file of files) {
      const name = file.name || "upload";
      const buffer = Buffer.from(await file.arrayBuffer());

      if (name.toLowerCase().endsWith(".csv")) {
        const text = buffer.toString("utf-8");
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        const fields = parsed.meta.fields || [];
        const hasKnownHeaders = fields.some((field) =>
          ["doc_id", "sentence_blurb", "ner_re_output", "tuple_output"].includes(field),
        );

        if (hasKnownHeaders) {
          for (const row of parsed.data) {
            if (!row) continue;
            const sentenceBlurb = row.sentence_blurb || "";
            const docId = row.doc_id || name;
            const nerOutput = row.ner_re_output || row.tuple_output || "";
            if (nerOutput.trim()) {
              tupleRows.push({
                doc_id: docId,
                sentence_blurb: sentenceBlurb,
                ner_re_output: nerOutput,
              });
            } else if (sentenceBlurb.trim()) {
              rows.push({
                doc_id: docId,
                sentence_blurb: sentenceBlurb,
              });
            }
          }
        } else {
          const parsedRows = Papa.parse(text, {
            header: false,
            skipEmptyLines: true,
          }).data as unknown[];
          for (const raw of parsedRows) {
            if (!Array.isArray(raw)) continue;
            if (raw.length < 2) continue;
            const [docId, sentenceBlurb, ...rest] = raw as string[];
            const nerOutput = rest.join(",") || "";
            if (nerOutput.trim()) {
              tupleRows.push({
                doc_id: docId || name,
                sentence_blurb: sentenceBlurb || "",
                ner_re_output: nerOutput,
              });
            } else if ((sentenceBlurb || "").trim()) {
              rows.push({
                doc_id: docId || name,
                sentence_blurb: sentenceBlurb || "",
              });
            }
          }
        }
        continue;
      }

      const doc = await mammoth.extractRawText({ buffer });
      const sentences = splitSentences(doc.value || "");
      const blurbs = chunkSentences(sentences, blurbSize);
      for (const blurb of blurbs) {
        if (applyFilter && !isRelevant(blurb)) continue;
        rows.push({ doc_id: name, sentence_blurb: blurb });
      }
    }

    if (!rows.length && !tupleRows.length) {
      return NextResponse.json({ error: "No blurbs or tuples extracted" }, { status: 400 });
    }

    const timestamp = Date.now();
    const blurbsPath = path.join("/tmp", `blurbs_${timestamp}.csv`);
    const tuplesPath = path.join("/tmp", `tuples_${timestamp}.csv`);
    const mergedPath = path.join("/tmp", `merged_${timestamp}.txt`);

    const blurbCsv = [
      ["doc_id", "sentence_blurb"].join(","),
      ...rows.map((row) => `${csvEscape(row.doc_id)},${csvEscape(row.sentence_blurb)}`),
    ].join("\n");
    await fs.writeFile(blurbsPath, blurbCsv, "utf-8");

    for (const row of rows) {
      const output = await extractTuples(row.sentence_blurb);
      tupleRows.push({ ...row, ner_re_output: output });
    }

    const tupleCsv = [
      ["doc_id", "sentence_blurb", "ner_re_output"].join(","),
      ...tupleRows.map(
        (row) =>
          `${csvEscape(row.doc_id)},${csvEscape(row.sentence_blurb)},${csvEscape(row.ner_re_output)}`,
      ),
    ].join("\n");
    await fs.writeFile(tuplesPath, tupleCsv, "utf-8");

    const combinedTuples = tupleRows.map((row) => row.ner_re_output).join("\n{record_delimiter}\n");
    let mergedTuples = mergeTuplesLocally(combinedTuples);
    if (combinedTuples.length < 12000) {
      try {
        const coref = await corefTuples(combinedTuples);
        if (hasValidEntities(coref)) {
          mergedTuples = coref;
        }
      } catch {
        // fall back to local merge
      }
    }

    await fs.writeFile(mergedPath, mergedTuples, "utf-8");

    return NextResponse.json({
      blurbsCsvPath: blurbsPath,
      tuplesCsvPath: tuplesPath,
      mergedTuplesPath: mergedPath,
      blurbCount: rows.length,
      tupleCount: tupleRows.length,
      mergedTuples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
