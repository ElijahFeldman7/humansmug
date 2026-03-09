import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function isBorderCategory(category: string) {
  const cat = (category || "").trim().toUpperCase();
  return cat === "BORDER" || cat === "ROUTE" || cat === "ROUTES" || cat === "REGION" || cat === "COUNTRY";
}

async function geocodeWithNominatim(location: LocationInput): Promise<ResolvedLocation | null> {
  const query = encodeURIComponent(location.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${query}`, {
    headers: {
      "User-Agent": "humansmug-link-kg/1.0",
      Accept: "application/json",
    },
    signal: controller.signal,
    cache: "no-store",
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    class?: string;
    type?: string;
    addresstype?: string;
  }>;

  const first = data[0];
  if (!first?.lat || !first?.lon) {
    return null;
  }

  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const addresstype = (first.addresstype || first.type || "").toLowerCase();
  const isBoundaryShape =
    isBorderCategory(location.category) ||
    first.class === "boundary" ||
    ["country", "state", "region", "county", "administrative"].includes(addresstype);

  return {
    name: location.name,
    lat,
    lon,
    resolvedName: first.display_name || location.name,
    kind: isBoundaryShape ? "border" : "pin",
  };
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

    const targets = locations.slice(0, 30);
    const resolved: ResolvedLocation[] = [];

    const concurrency = 6;
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (loc) => {
          try {
            return await geocodeWithNominatim(loc);
          } catch {
            return null;
          }
        }),
      );
      for (const item of batchResults) {
        if (item) resolved.push(item);
      }
    }

    return NextResponse.json({ locations: resolved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
