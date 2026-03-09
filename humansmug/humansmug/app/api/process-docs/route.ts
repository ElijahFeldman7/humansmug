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
- Goal -
You are a highly precise and intelligent coreference resolution system designed to support named entity recognition
(NER) and knowledge graph construction. Your task is to resolve all coreferences related to the Person entity
type—including roles and titles (e.g., Defendant, Officer, Agent)—in a given input text, while strictly preserving its
original structure and wording. The resolved output will be used for extracting person entities and relationships in
the context of human smuggling networks. Therefore, maintaining accuracy and consistency is critical. Do not
summarize, explain, or alter the text—only return the full, unmodified input with Person coreferences resolved
according to the rules below.
Note: This is an unsupervised coreference resolution task. The instructions are designed to guide you in resolving
person-related references. While examples are provided, they do not cover all scenarios. You must infer and apply
coreference logic based on contextual understanding, even when phrasing or structure varies.
- Coreference Resolution Rules — Person Entity Type -
• After a person is introduced with their full name (e.g., Paul Silva), replace all subsequent mentions—including
last name only (e.g., S.), role + last name (e.g., Agent S.), and abbreviated forms (e.g., BPA S.)—with the full
name only.
• In all coreference resolutions, strip titles from mentions. For example, "Agent I." or "Agent J.C.D.A." should
resolve to "Hector D.I." or "J.C.D.A.".
• For compound names, match based on the final component (e.g., I., R.) and resolve to the full name.
• If two or more individuals share a last name, resolve ambiguous mentions conservatively—default to the most
recently introduced full name unless context clearly indicates otherwise.
• If abbreviated titles appear (e.g., BPA, Agent, Officer + Last Name), remove the title and resolve to the full name.
• If a person is introduced as "Defendant M.D.J.G.", resolve it to "M.D.J.G" immediately and throughout.
• If someone is introduced as "Border Patrol Agent H.D.I", retain this in the first mention, but resolve all later
mentions (e.g., "Agent I.") to "H.D.I".
• Apply all replacements across the entire document, including headers, transcripts, footnotes, and end-ofdocument text.
Multiple Defendants:
• If multiple defendants are introduced, resolve "the defendants" to a comma-separated list of their full names, in
the order introduced.
• "The defendant" (singular) should resolve to the most recently mentioned full defendant name unless context
indicates otherwise.
• Always resolve all such role-based mentions, even in peripheral document sections.
- Examples -
Example 1:
Input: Border Patrol Agent B.S. observed the vehicle. BPA S. contacted another agent.
Output: Border Patrol Agent B.S. observed the vehicle. B.S. contacted another agent.
Example 2:
Input: Border Patrol Agent H.D.I led the operation. I. coordinated with the local sheriff.
Output: Border Patrol Agent H.D.I. led the operation. H.D.I coordinated with the local sheriff. ....
- Input Text -
Resolve all Person entity coreferences in the following document, including those in footnotes and headers. Return
only the modified text. If none exist, return the input unchanged. Do not summarize or explain. Input_text:
{input_text}
Output:

When taking tuples and merging them, do NOT pick just the first description. Merge all descriptions and retain every
distinct factual detail. Deduplicate repeats but keep unique qualifiers (roles, locations, dates, aliases, methods,
affiliations). If details conflict, keep both. Keep descriptions compact but information-dense.
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
        generationConfig: { temperature: 0.1 },
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

async function extractTuples(blurb: string) {
  const prompt = `${EXTRACTION_PROMPT}\n\nentity_types: ${ENTITY_TYPES.join(", ")}\n\nInput:\n${blurb}\n\nOutput:\n`;
  try {
    return await callGemini(prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return `("entity"{tuple_delimiter}EXTRACTION_ERROR{tuple_delimiter}ORGANIZATION{tuple_delimiter}${message})\n{record_delimiter}\n{completion_delimiter}`;
  }
}

async function corefTuples(allTuples: string) {
  const prompt = `${COREF_PROMPT}\n\nTuples:\n${allTuples}\n`;
  return callGemini(prompt);
}

function normalizeName(value?: string) {
  const safe = String(value || "");
  return safe.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function isJunkEntity(name: string): boolean {
  const n = name.trim();
  if (n.length <= 2) return true;
  // List markers like "C)", "IV)", "A."
  if (/^[A-Z]{1,3}\)$/.test(n) || /^[A-Z]\.$/.test(n)) return true;
  // Pure numbers or case citations
  if (/^\d+$/.test(n)) return true;
  // Common legal/non-entity terms
  const LEGAL_JUNK = new Set([
    "PLAINTIFF", "DEFENDANT", "DEFENDANTS", "PLAINTIFFS",
    "ATTORNEY", "COURT", "DISTRICT COURT", "STATE", "STATES",
    "ISSUE", "PRIVITY", "MOVANT", "NONMOVANTS", "AGENTS",
    "COMMISSIONER", "LAND OFFICER",
  ]);
  if (LEGAL_JUNK.has(normalizeName(n))) return true;
  // Very short abbreviations that aren't meaningful entities
  const SHORT_JUNK = new Set([
    "CT", "CIV", "WL", "FED", "BP", "LIN", "F2D",
  ]);
  if (SHORT_JUNK.has(normalizeName(n))) return true;
  return false;
}

function mergeTuplesLocally(raw: string) {
  const norm = String(raw || "")
    .replace(/""/g, '"')
    .replace(/\{tuple_delimiter\}/g, "\x01")
    .replace(/\{record_delimiter\}/g, "\n")
    .replace(/\{completion_delimiter\}/g, "");

  // key → { canonicalName, type, descs[] }
  const entityData = new Map<string, { canonicalName: string; type: string; descs: string[] }>();
  // key → canonical key (for near-duplicate resolution)
  const keyAlias = new Map<string, string>();
  const relationshipLines: string[] = [];
  const lines = norm.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const SEP = "|";
  const buildEntityLine = (name: string, type: string, descs: string[]) => {
    const combined = descs.filter(Boolean).join(" || ");
    return `("entity"${SEP}${name}${SEP}${type}${SEP}${combined})`;
  };
  const buildRelLine = (source: string, target: string, label: string, strength: string) =>
    `("relationship"${SEP}${source}${SEP}${target}${SEP}${label}${SEP}${strength})`;

  // Pass 1: collect all entities with their descriptions
  for (const line of lines) {
    const normalizedLine = line.replace(/""/g, '"');
    const isEntity = normalizedLine.startsWith('("entity"');
    const isRel = normalizedLine.startsWith('("relationship"');
    if (!isEntity && !isRel) continue;

    const separator = normalizedLine.includes("\x01") ? "\x01" : "|";
    const parts = normalizedLine
      .split(separator)
      .map((p) => String(p ?? "").replace(/^"|"$/g, "").replace(/^\("|"\)$/g, "").trim());

    if (isEntity) {
      const name = parts[1] || "";
      const type = parts[2] || "DEFAULT";
      const desc = parts.slice(3).join(" ").replace(/\)$/, "").trim();
      if (isJunkEntity(name)) continue;
      const key = normalizeName(name);
      if (!key) continue;

      if (entityData.has(key)) {
        const existing = entityData.get(key)!;
        // Keep longer canonical name
        if (name.length > existing.canonicalName.length) {
          existing.canonicalName = name;
        }
        // Accumulate unique descriptions
        if (desc && !existing.descs.includes(desc)) {
          existing.descs.push(desc);
        }
      } else {
        entityData.set(key, {
          canonicalName: name,
          type,
          descs: desc ? [desc] : [],
        });
      }
      continue;
    }

    if (isRel) {
      relationshipLines.push(normalizedLine);
    }
  }

  // Pass 2: near-duplicate resolution (merge shorter into longer when same type)
  const keys = [...entityData.keys()];
  for (let i = 0; i < keys.length; i++) {
    const keyA = keys[i];
    if (keyAlias.has(keyA)) continue; // already merged
    const dataA = entityData.get(keyA)!;

    for (let j = i + 1; j < keys.length; j++) {
      const keyB = keys[j];
      if (keyAlias.has(keyB)) continue;
      const dataB = entityData.get(keyB)!;

      // Must be same type
      if (dataA.type !== dataB.type) continue;

      const shorter = keyA.length <= keyB.length ? keyA : keyB;
      const longer = keyA.length <= keyB.length ? keyB : keyA;

      // Shorter must be contained in longer
      if (!longer.includes(shorter)) continue;

      // Shorter must be >= 4 chars and >= 40% of longer
      if (shorter.length < 4) continue;
      if (shorter.length / longer.length < 0.4) continue;

      // Avoid merging generic terms that happen to be substrings
      const GENERIC_TERMS = new Set([
        "UNITED STATES", "BORDER", "FEDERAL", "DISTRICT",
        "LEXIS", "MICHAEL S",
      ]);
      if (GENERIC_TERMS.has(shorter)) continue;

      // Don't merge location names where shorter is a standalone city/place
      // that differs from the longer compound (e.g. LAREDO ≠ LAREDO SECTOR)
      if (dataA.type === "LOCATION" || dataB.type === "LOCATION") {
        // Only merge if longer is "shorter + state/country qualifier"
        // e.g. STARR COUNTY → STARR COUNTY TEXAS (ok)
        // but LAREDO → LAREDO SECTOR (not ok)
        const suffix = longer.slice(shorter.length).trim();
        const STATE_QUALIFIERS = /^(TEXAS|TX|CALIFORNIA|CA|ARIZONA|AZ|NEW MEXICO|NM|MEXICO|USA|DC|COUNTY|SECTOR|AREA|REGION)?$/i;
        if (!STATE_QUALIFIERS.test(suffix)) continue;
      }

      // Don't merge case citation numbers
      if (/^\d+\s/.test(shorter) || /LEXIS/.test(shorter)) continue;

      // Merge: keep the longer name as canonical, merge descriptions
      const shorterData = entityData.get(shorter)!;
      const longerData = entityData.get(longer)!;

      for (const d of shorterData.descs) {
        if (d && !longerData.descs.includes(d)) {
          longerData.descs.push(d);
        }
      }
      if (shorterData.canonicalName.length > longerData.canonicalName.length) {
        longerData.canonicalName = shorterData.canonicalName;
      }

      // Alias shorter key → longer key
      keyAlias.set(shorter, longer);
    }
  }

  // Pass 3: PERSON entities — merge by shared last name
  // e.g. "JOE BIDEN" and "JOSEPH R BIDEN JR" share last name "BIDEN"
  for (let i = 0; i < keys.length; i++) {
    const keyA = keys[i];
    if (keyAlias.has(keyA)) continue;
    const dataA = entityData.get(keyA)!;
    if (dataA.type !== "PERSON") continue;

    const wordsA = keyA.split(/\s+/);
    if (wordsA.length < 2) continue; // need at least first + last name

    for (let j = i + 1; j < keys.length; j++) {
      const keyB = keys[j];
      if (keyAlias.has(keyB)) continue;
      const dataB = entityData.get(keyB)!;
      if (dataB.type !== "PERSON") continue;

      const wordsB = keyB.split(/\s+/);
      if (wordsB.length < 2) continue;

      // Extract last name (strip JR, SR, II, III, IV suffixes)
      const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
      const lastA = [...wordsA].reverse().find((w) => !SUFFIXES.has(w)) || wordsA[wordsA.length - 1];
      const lastB = [...wordsB].reverse().find((w) => !SUFFIXES.has(w)) || wordsB[wordsB.length - 1];

      if (lastA !== lastB) continue;
      if (lastA.length < 3) continue; // avoid single-letter matches

      // Check first name compatibility — first letters should match OR
      // one is a clear abbreviation of the other
      const firstA = wordsA[0];
      const firstB = wordsB[0];
      if (firstA[0] !== firstB[0]) continue;

      // Merge: prefer the longer/more complete name
      const shorter = keyA.length <= keyB.length ? keyA : keyB;
      const longer = keyA.length <= keyB.length ? keyB : keyA;
      const shorterData = entityData.get(shorter)!;
      const longerData = entityData.get(longer)!;

      for (const d of shorterData.descs) {
        if (d && !longerData.descs.includes(d)) {
          longerData.descs.push(d);
        }
      }
      if (shorterData.canonicalName.length > longerData.canonicalName.length) {
        longerData.canonicalName = shorterData.canonicalName;
      }
      keyAlias.set(shorter, longer);
    }
  }

  // Resolve alias chains
  function resolveKey(key: string): string {
    const visited = new Set<string>();
    let current = key;
    while (keyAlias.has(current) && !visited.has(current)) {
      visited.add(current);
      current = keyAlias.get(current)!;
    }
    return current;
  }

  // Build entity lines from resolved data
  const entityLines: string[] = [];
  const canonicalMap = new Map<string, string>(); // normalized key → canonical name
  for (const [key, data] of entityData) {
    if (keyAlias.has(key)) continue; // skip aliased entities
    entityLines.push(buildEntityLine(data.canonicalName, data.type, data.descs));
    canonicalMap.set(key, data.canonicalName);
  }

  // Also map aliased keys to their canonical names
  for (const [aliasKey] of keyAlias) {
    const resolved = resolveKey(aliasKey);
    const resolvedData = entityData.get(resolved);
    if (resolvedData) {
      canonicalMap.set(aliasKey, resolvedData.canonicalName);
    }
  }

  // Resolve relationship entity references
  const mergedRelationships = relationshipLines.map((line) => {
    const separator = line.includes("\x01") ? "\x01" : "|";
    const parts = line
      .split(separator)
      .map((p) => String(p ?? "").replace(/^"|"$/g, "").replace(/^\("|"\)$/g, "").trim());
    if (parts.length < 4) return line;
    const sourceKey = resolveKey(normalizeName(parts[1]));
    const targetKey = resolveKey(normalizeName(parts[2]));
    const source = canonicalMap.get(sourceKey) || parts[1];
    const target = canonicalMap.get(targetKey) || parts[2];
    // Skip relationships involving junk entities
    if (isJunkEntity(source) || isJunkEntity(target)) return null;
    // Skip self-loops
    if (sourceKey === targetKey) return null;
    const label = parts[3] || "";
    const strength = parts[4]?.replace(/\)$/, "") || "5";
    return buildRelLine(source, target, label, strength);
  }).filter((l): l is string => l !== null);

  // Deduplicate relationships (same source+target+label → keep highest strength)
  const relMap = new Map<string, { line: string; strength: number }>();
  for (const line of mergedRelationships) {
    const parts = line.split(SEP).map((p) => p.replace(/^"|"$/g, "").replace(/^\("|"\)$/g, "").trim());
    const key = `${normalizeName(parts[1])}||${normalizeName(parts[2])}||${normalizeName(parts[3])}`;
    const strength = Number(parts[4]) || 0;
    const existing = relMap.get(key);
    if (!existing || strength > existing.strength) {
      relMap.set(key, { line, strength });
    }
  }

  const merged = [...entityLines, ...[...relMap.values()].map((v) => v.line)];
  if (!merged.length) {
    return "{completion_delimiter}";
  }
  return merged.join("\n{record_delimiter}\n") + "\n{record_delimiter}\n{completion_delimiter}";
}

type Citation = {
  docId: string;
  sentence: string;
  fileUrl?: string;
};

function extractEvidenceMap(rows: Array<{ doc_id?: string; sentence_blurb: string; ner_re_output: string }>) {
  const evidence = new Map<string, string>();
  for (const row of rows) {
    const raw = String(row.ner_re_output || "")
      .replace(/""/g, '"')
      .replace(/\{tuple_delimiter\}/g, "\x01")
      .replace(/\{record_delimiter\}/g, "\n")
      .replace(/\{completion_delimiter\}/g, "");
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith('("relationship"')) continue;
      const separator = line.includes("\x01") ? "\x01" : "|";
      const parts = line
        .split(separator)
        .map((p) => String(p ?? "").replace(/^"|"$/g, "").trim());
      if (parts.length < 4) continue;
      const source = normalizeName(parts[1]);
      const target = normalizeName(parts[2]);
      const label = normalizeName(parts[3]);
      const key = `${source}||${target}||${label}`;
      if (!evidence.has(key) && row.sentence_blurb) {
        evidence.set(key, row.sentence_blurb);
      }
    }
  }
  return Object.fromEntries(evidence.entries());
}

function extractCitationMap(
  rows: Array<{ doc_id?: string; sentence_blurb: string; ner_re_output: string }>,
  savedFiles: Map<string, string>,
) {
  // Maps entity name (normalized) → Citation[]
  const entityCitations = new Map<string, Citation[]>();
  // Maps relationship key → Citation[]
  const edgeCitations = new Map<string, Citation[]>();

  for (const row of rows) {
    const raw = String(row.ner_re_output || "")
      .replace(/""/g, '"')
      .replace(/\{tuple_delimiter\}/g, "\x01")
      .replace(/\{record_delimiter\}/g, "\n")
      .replace(/\{completion_delimiter\}/g, "");
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const docId = row.doc_id || "";
    const sentence = row.sentence_blurb || "";
    if (!sentence) continue;

    const fileUrl = savedFiles.get(docId) || undefined;
    const citation: Citation = { docId, sentence, fileUrl };

    for (const line of lines) {
      const isEntity = line.startsWith('("entity"');
      const isRel = line.startsWith('("relationship"');
      if (!isEntity && !isRel) continue;

      const separator = line.includes("\x01") ? "\x01" : "|";
      const parts = line
        .split(separator)
        .map((p) => String(p ?? "").replace(/^"|"$/g, "").replace(/^\("|"\)$/g, "").trim());

      if (isEntity && parts.length >= 2) {
        const key = normalizeName(parts[1]);
        if (!key) continue;
        const existing = entityCitations.get(key) || [];
        // Deduplicate by sentence
        if (!existing.some((c) => c.sentence === sentence)) {
          existing.push(citation);
          entityCitations.set(key, existing);
        }
      }

      if (isRel && parts.length >= 4) {
        const source = normalizeName(parts[1]);
        const target = normalizeName(parts[2]);
        const label = normalizeName(parts[3]);
        const key = `${source}||${target}||${label}`;
        const existing = edgeCitations.get(key) || [];
        if (!existing.some((c) => c.sentence === sentence)) {
          existing.push(citation);
          edgeCitations.set(key, existing);
        }
      }
    }
  }

  return {
    entities: Object.fromEntries(entityCitations.entries()),
    edges: Object.fromEntries(edgeCitations.entries()),
  };
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
    const runCorefParam = form.get("runCoref");
    let runCoref = runCorefParam === null ? true : String(runCorefParam) !== "false";

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    // Save uploaded files to public/uploads for citation linking
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const savedFiles = new Map<string, string>(); // docId → public URL

    const rows: Array<{ doc_id: string; sentence_blurb: string }> = [];
    const tupleRows: Array<{ doc_id: string; sentence_blurb: string; ner_re_output: string }> = [];

    for (const file of files) {
      const name = file.name || "upload";
      const buffer = Buffer.from(await file.arrayBuffer());

      // Save the file locally for citation access
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const savedPath = path.join(uploadsDir, safeName);
      await fs.writeFile(savedPath, buffer);
      savedFiles.set(name, `/uploads/${safeName}`);

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
    const evidenceMap = extractEvidenceMap(tupleRows);
    const citationMap = extractCitationMap(tupleRows, savedFiles);
    if (tupleRows.length && !rows.length && runCorefParam === null) {
      runCoref = false;
    }
    if (runCoref && combinedTuples.length < 12000) {
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
      evidenceMap,
      citationMap,
      savedFiles: Object.fromEntries(savedFiles.entries()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
