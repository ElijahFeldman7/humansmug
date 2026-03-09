import { NextResponse } from "next/server";

export const runtime = "nodejs";

type LocationInput = {
  name: string;
  category: string;
  description: string;
};

type ResolvedLocation = {
  name: string;
  lat: number;
  lon: number;
  resolvedName: string;
  kind: "pin" | "border";
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

function buildPrompt(locations: LocationInput[], contextHint: string) {
  const lines = locations.map(
    (loc, i) =>
      `${i + 1}. Name: "${loc.name}" | Category: ${loc.category} | Description: "${loc.description}"`,
  );

  return `You are a geographic resolver for a knowledge graph about human smuggling and migration routes.
Given a list of location-like entities extracted from text, determine the real-world geographic coordinates for each.

Context from the source text: ${contextHint}

IMPORTANT:
- These locations relate to smuggling/migration routes, typically in the Americas (US, Mexico, Central America, South America) unless the text clearly indicates otherwise.
- Do NOT return locations in India, Asia, or other unrelated regions unless the context clearly refers to those places.
- For border crossings like "US-MEXICO BORDER", pick a representative point along that border (e.g., a major crossing).
- For routes or highways, pick a midpoint or notable point along that route.
- For vague names, use the description and context to determine the most likely real-world location.
- If a name is not a real geographic location (e.g., an organization name that sounds like a place), return null coordinates.

Locations to resolve:
${lines.join("\n")}

Respond with ONLY a JSON array (no markdown fences). Each element should be:
{"name": "<original name>", "lat": <number>, "lon": <number>, "resolvedName": "<what this actually refers to>", "kind": "<pin or border>"}

Use "border" for regions/borders/countries, "pin" for specific cities/towns/points.
If you cannot determine coordinates, use {"name": "<name>", "lat": null, "lon": null, "resolvedName": "unknown", "kind": "pin"}.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      locations?: LocationInput[];
      contextHint?: string;
    };
    const locations = Array.isArray(body.locations) ? body.locations : [];
    const contextHint = body.contextHint || "";

    if (locations.length === 0) {
      return NextResponse.json({ locations: [] });
    }

    const prompt = buildPrompt(locations.slice(0, 30), contextHint);
    const output = await callGemini(prompt);

    const cleaned = output
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: ResolvedLocation[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Gemini response", raw: cleaned },
        { status: 502 },
      );
    }

    const valid = parsed.filter(
      (loc) =>
        loc.name &&
        typeof loc.lat === "number" &&
        typeof loc.lon === "number" &&
        Number.isFinite(loc.lat) &&
        Number.isFinite(loc.lon),
    );

    return NextResponse.json({ locations: valid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
