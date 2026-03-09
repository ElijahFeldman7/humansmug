"use client";

import type L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EdgeMeta, NodeMeta } from "@/app/lib/graph/types";
import { getColor } from "@/app/lib/graph/constants";

const GEO_CACHE_KEY = "humansmug:geoCache:v1";

type MapPanelProps = {
  nodeMetaMap: Record<string, NodeMeta>;
  edgeMetaMap: Record<string, EdgeMeta>;
  isActive: boolean;
};

type GeoLocation = {
  name: string;
  displayName: string;
  kind: "pin" | "border";
  lat: number;
  lon: number;
};

type RouteGeometry = {
  id: string;
  path: Array<[number, number]>;
};

type GeminiGeoResult = {
  name: string;
  lat: number;
  lon: number;
  resolvedName: string;
  kind: "pin" | "border";
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function isIgnoredMapName(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return true;
  const upper = value.toUpperCase();

  if (
    upper.includes("US DISTRICT COURT") ||
    upper.includes("U.S. DISTRICT COURT") ||
    upper.includes("DISTRICT COURT") ||
    upper.includes("COURT OF APPEALS") ||
    upper.includes("SUPREME COURT")
  ) {
    return true;
  }

  if (/(\s|^)v\.(\s|$)/i.test(value) || /(\s|^)vs\.(\s|$)/i.test(value)) return true;
  if (/\bno\.\s*[0-9A-Z-]+\b/i.test(value)) return true;
  if (/\b\d{4}\s+WL\s+\d+\b/i.test(value)) return true;
  if (/\b\d+\s+F\.(?:\s?SUPP\.?\s?\d*|\dD|\dTH|APP'?X)\s+\d+\b/i.test(upper)) return true;

  return false;
}

function loadGeoCache(): Record<string, GeoLocation> {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, GeoLocation>;
  } catch { /* ignore */ }
  return {};
}

function saveGeoCache(cache: Record<string, GeoLocation>) {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

export default function MapPanel({ nodeMetaMap, edgeMetaMap, isActive }: MapPanelProps) {
  const [geoLocations, setGeoLocations] = useState<GeoLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoProgress, setGeoProgress] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [routeGeometries, setRouteGeometries] = useState<RouteGeometry[]>([]);
  const [showEntities, setShowEntities] = useState(true);
  const fetchedRef = useRef<Record<string, GeoLocation>>(loadGeoCache());
  const routeCacheRef = useRef<Record<string, RouteGeometry>>({});
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initAttemptsRef = useRef(0);

  const ensureMapReady = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      // Container not yet rendered — retry
      if (initAttemptsRef.current < 40) {
        initAttemptsRef.current += 1;
        setTimeout(() => {
          ensureMapReady();
        }, 100);
      }
      return;
    }
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) {
      if (initAttemptsRef.current < 40) {
        initAttemptsRef.current += 1;
        setTimeout(() => {
          ensureMapReady();
        }, 100);
      }
      return;
    }

    const initMap = async () => {
      let Leaf: typeof import("leaflet");
      try {
        Leaf = leafletRef.current || (await import("leaflet"));
        leafletRef.current = Leaf;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load Leaflet.",
        );
        return;
      }

      delete (Leaf.Icon.Default as unknown as { prototype?: { _getIconUrl?: unknown } }).prototype
        ?._getIconUrl;
      Leaf.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (mapRef.current) {
        if (mapRef.current.getContainer() !== container) {
          mapRef.current.remove();
          mapRef.current = null;
        } else {
          mapRef.current.invalidateSize();
          setMapReady(true);
          return;
        }
      }

      const map = Leaf.map(container, {
        zoomControl: true,
        preferCanvas: true,
      }).setView([32.5, -99.5], 4);

      mapRef.current = map;

      const tileLayer = Leaf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        crossOrigin: true,
      });
      tileLayer.on("load", () => setMapReady(true));
      tileLayer.on("tileerror", () => setError("Tile load failed. Check network/CSP."));
      tileLayer.addTo(map);

      layerGroupRef.current = Leaf.layerGroup().addTo(map);

      // Force size recalculation after a brief delay to handle layout shifts
      setTimeout(() => {
        map.invalidateSize();
        setMapReady(true);
      }, 300);

      setError(null);
    };

    void initMap();
  }, []);

  useEffect(() => {
    initAttemptsRef.current = 0;
    ensureMapReady();

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        mapRef.current?.invalidateSize();
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, [ensureMapReady]);

  useEffect(() => {
    if (!isActive) return;
    initAttemptsRef.current = 0;
    ensureMapReady();
    const t1 = setTimeout(() => mapRef.current?.invalidateSize(), 200);
    const t2 = setTimeout(() => mapRef.current?.invalidateSize(), 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ensureMapReady, isActive]);

  const locationCategories = useMemo(
    () =>
      new Set([
        "LOCATION",
        "PLACE",
        "REGION",
        "STATE",
        "CITY",
        "COUNTY",
        "COUNTRY",
        "BORDER",
        "ROUTE",
        "ROUTES",
        "ROAD",
        "HIGHWAY",
      ]),
    [],
  );

  const locations = useMemo(
    () =>
      Object.values(nodeMetaMap).filter(
        (node) =>
          locationCategories.has(node.category.toUpperCase()) &&
          !isIgnoredMapName(node.name),
      ),
    [nodeMetaMap, locationCategories],
  );

  // Build a context hint from all node descriptions for Gemini
  const contextHint = useMemo(() => {
    const descs = Object.values(nodeMetaMap)
      .map((n) => n.desc)
      .filter(Boolean)
      .slice(0, 10);
    return descs.join(". ").slice(0, 500);
  }, [nodeMetaMap]);

  useEffect(() => {
    if (locations.length === 0) {
      setGeoLocations([]);
      return;
    }

    let isCancelled = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      setGeoProgress("Resolving locations...");

      const maxLocations = 25;
      const targets = locations.slice(0, maxLocations);

      // Check cache first
      const uncached: typeof targets = [];
      const cached: GeoLocation[] = [];
      for (const loc of targets) {
        const key = normalizeText(loc.name);
        if (fetchedRef.current[key]) {
          cached.push(fetchedRef.current[key]);
        } else {
          uncached.push(loc);
        }
      }

      if (uncached.length === 0) {
        if (!isCancelled) {
          setGeoLocations(cached);
          setIsLoading(false);
          setGeoProgress("");
        }
        return;
      }

      try {
        const response = await fetch("/api/geocode-locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: uncached.map((loc) => ({
              name: loc.name,
              category: loc.category,
              description: loc.desc || "",
            })),
            contextHint,
          }),
        });

        if (!response.ok) {
          throw new Error(`Geocoding API error ${response.status}`);
        }

        const payload = (await response.json()) as {
          locations?: GeminiGeoResult[];
          error?: string;
        };

        if (payload.error) {
          throw new Error(payload.error);
        }

        const resolved = (payload.locations || []).map((loc) => {
          const geo: GeoLocation = {
            name: loc.name,
            displayName: loc.resolvedName,
            kind: loc.kind,
            lat: loc.lat,
            lon: loc.lon,
          };
          fetchedRef.current[normalizeText(loc.name)] = geo;
          return geo;
        });
        saveGeoCache(fetchedRef.current);

        if (!isCancelled) {
          setGeoLocations([...cached, ...resolved]);
          setIsLoading(false);
          if (locations.length > maxLocations) {
            setGeoProgress(`Showing ${maxLocations}/${locations.length} locations.`);
          } else {
            setGeoProgress("");
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Failed to geocode locations");
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      isCancelled = true;
    };
  }, [locations, contextHint]);

  const locationCenters = useMemo(
    () =>
      geoLocations.map((loc) => [loc.lat, loc.lon] as [number, number]),
    [geoLocations],
  );

  const geoByName = useMemo(() => {
    const map = new Map<string, GeoLocation>();
    geoLocations.forEach((loc) => map.set(loc.name, loc));
    return map;
  }, [geoLocations]);

  const routeLines = useMemo(() => {
    const lines: Array<{ id: string; path: Array<[number, number]>; label: string }> = [];
    for (const edge of Object.values(edgeMetaMap)) {
      const source = geoByName.get(edge.source);
      const target = geoByName.get(edge.target);
      if (!source || !target) continue;
      lines.push({
        id: edge.id,
        path: [
          [source.lat, source.lon],
          [target.lat, target.lon],
        ],
        label: edge.label,
      });
    }
    return lines;
  }, [edgeMetaMap, geoByName]);

  useEffect(() => {
    let isCancelled = false;
    const fetchRoutes = async () => {
      const results: RouteGeometry[] = [];
      for (const line of routeLines) {
        const cached = routeCacheRef.current[line.id];
        if (cached) {
          results.push(cached);
          continue;
        }

        if (line.path.length !== 2) continue;
        const [[fromLat, fromLon], [toLat, toLon]] = line.path;
        try {
          const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`,
          );
          if (!response.ok) {
            throw new Error(`OSRM error ${response.status}`);
          }
          const payload = (await response.json()) as {
            routes?: Array<{ geometry?: { coordinates: number[][] } }>;
          };
          const coords = payload.routes?.[0]?.geometry?.coordinates;
          if (coords && coords.length > 1) {
            const path = coords.map(([lon, lat]) => [lat, lon] as [number, number]);
            const route = { id: line.id, path };
            routeCacheRef.current[line.id] = route;
            results.push(route);
          }
        } catch {
          const fallback = { id: line.id, path: line.path };
          routeCacheRef.current[line.id] = fallback;
          results.push(fallback);
        }
      }

      if (!isCancelled) {
        setRouteGeometries(results);
      }
    };

    void fetchRoutes();
    return () => {
      isCancelled = true;
    };
  }, [routeLines]);

  // Compute non-location entities positioned near their connected locations
  const entityOverlays = useMemo(() => {
    if (!showEntities) return [];
    const overlays: Array<{
      name: string;
      category: string;
      lat: number;
      lon: number;
      color: string;
      connections: string[];
    }> = [];

    const geoByNameLower = new Map<string, GeoLocation>();
    for (const loc of geoLocations) {
      geoByNameLower.set(loc.name.toLowerCase(), loc);
    }

    // For each non-location node, check if it connects to any geocoded location
    for (const node of Object.values(nodeMetaMap)) {
      if (locationCategories.has(node.category.toUpperCase())) continue;

      const connectedLocs: GeoLocation[] = [];
      for (const edge of Object.values(edgeMetaMap)) {
        const peer =
          edge.source === node.name ? edge.target :
          edge.target === node.name ? edge.source : null;
        if (!peer) continue;
        const loc = geoByNameLower.get(peer.toLowerCase());
        if (loc) connectedLocs.push(loc);
      }

      if (connectedLocs.length === 0) continue;

      // Average position of connected locations + small jitter to avoid overlap
      const avgLat = connectedLocs.reduce((s, l) => s + l.lat, 0) / connectedLocs.length;
      const avgLon = connectedLocs.reduce((s, l) => s + l.lon, 0) / connectedLocs.length;
      // Deterministic jitter based on name hash
      const hash = node.name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
      const jitterLat = ((hash % 100) / 100) * 0.8 - 0.4;
      const jitterLon = (((hash >> 8) % 100) / 100) * 0.8 - 0.4;

      const c = getColor(node.category);
      overlays.push({
        name: node.name,
        category: node.category,
        lat: avgLat + jitterLat,
        lon: avgLon + jitterLon,
        color: c.accent,
        connections: connectedLocs.map((l) => l.name),
      });
    }
    return overlays;
  }, [nodeMetaMap, edgeMetaMap, geoLocations, locationCategories, showEntities]);

  useEffect(() => {
    const Leaf = leafletRef.current;
    if (!Leaf || !mapRef.current || !layerGroupRef.current) return;
    layerGroupRef.current.clearLayers();

    for (const loc of geoLocations) {
      const marker = Leaf.circleMarker([loc.lat, loc.lon], {
        radius: loc.kind === "border" ? 10 : 7,
        color: loc.kind === "border" ? "#4af0b0" : "#5b8dff",
        fillColor: loc.kind === "border" ? "#4af0b0" : "#5b8dff",
        fillOpacity: 0.35,
        weight: 2,
      });
      marker.bindPopup(
        `<strong>${loc.name}</strong><br/><span style="font-size:0.8em;color:#888">${loc.displayName}</span>`,
      );
      marker.addTo(layerGroupRef.current!);
    }

    const routesToDraw = routeGeometries.length ? routeGeometries : routeLines;
    for (const line of routesToDraw) {
      Leaf.polyline(line.path, {
        color: "#5b8dff",
        weight: 4,
        opacity: 0.7,
      }).addTo(layerGroupRef.current!);
    }

    // Draw entity overlays (non-location nodes positioned near connected locations)
    for (const ent of entityOverlays) {
      const marker = Leaf.circleMarker([ent.lat, ent.lon], {
        radius: 6,
        color: ent.color,
        fillColor: ent.color,
        fillOpacity: 0.6,
        weight: 2,
      });
      marker.bindPopup(
        `<strong style="color:${ent.color}">${ent.name}</strong><br/>` +
        `<span style="font-size:0.75em;color:#888;text-transform:uppercase">${ent.category}</span><br/>` +
        `<span style="font-size:0.8em">Connected to: ${ent.connections.join(", ")}</span>`,
      );

      // Add a label
      const label = Leaf.tooltip({
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "entity-map-label",
      });
      label.setContent(ent.name);
      marker.bindTooltip(label);
      marker.addTo(layerGroupRef.current!);

      // Draw dashed lines from entity to each connected location
      for (const connName of ent.connections) {
        const loc = geoLocations.find((l) => l.name === connName);
        if (!loc) continue;
        Leaf.polyline(
          [[ent.lat, ent.lon], [loc.lat, loc.lon]],
          { color: ent.color, weight: 1.5, opacity: 0.4, dashArray: "4 4" },
        ).addTo(layerGroupRef.current!);
      }
    }

    if (locationCenters.length > 0) {
      mapRef.current.fitBounds(locationCenters, { padding: [30, 30] });
    }
  }, [geoLocations, routeLines, routeGeometries, locationCenters, entityOverlays]);

  return (
    <div className="relative flex h-full w-full">
      {/* Map fills the entire space */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Loading / error overlay */}
      {!mapReady && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.8rem] text-[#6272a4]">
          {error ? "Map failed to load." : "Loading map..."}
        </div>
      )}

      {/* Entity overlay label styles */}
      <style>{`
        .entity-map-label {
          background: rgba(13,15,20,0.85) !important;
          border: 1px solid #2a3347 !important;
          color: #cdd6f4 !important;
          font-size: 0.6rem !important;
          padding: 1px 5px !important;
          border-radius: 4px !important;
          box-shadow: none !important;
        }
        .entity-map-label::before { display: none !important; }
      `}</style>

      {/* Stats badge */}
      <div className="absolute left-3 top-3 z-[1000] flex items-center gap-3 rounded-lg border border-[#2a3347] bg-[#0d0f14]/90 px-3 py-1.5 text-[0.65rem] text-[#cdd6f4] backdrop-blur-sm">
        <span>
          <span className="font-bold text-[#5b8dff]">{geoLocations.filter((l) => l.kind === "pin").length}</span> pins
        </span>
        <span>
          <span className="font-bold text-[#4af0b0]">{geoLocations.filter((l) => l.kind === "border").length}</span> borders
        </span>
        <span>
          <span className="font-bold text-[#cdd6f4]">{routeLines.length}</span> routes
        </span>
        {entityOverlays.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEntities((v) => !v)}
            className={`ml-1 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold transition ${
              showEntities
                ? "bg-[#ff6b6b]/20 text-[#ff6b6b]"
                : "bg-[#2a3347] text-[#6272a4]"
            }`}
          >
            {entityOverlays.length} entities {showEntities ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {/* Loading status */}
      {isLoading && (
        <div className="absolute left-3 top-12 z-[1000] flex items-center gap-2 rounded-lg border border-[#2a3347] bg-[#0d0f14]/90 px-3 py-1.5 text-[0.65rem] text-[#6272a4] backdrop-blur-sm">
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:0ms]" />
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:300ms]" />
          <span className="ml-1">{geoProgress || "Resolving locations..."}</span>
        </div>
      )}

      {error && (
        <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-[#ff6b6b]/30 bg-[#0d0f14]/90 px-3 py-1.5 text-[0.65rem] text-[#ff6b6b] backdrop-blur-sm">
          {error}
        </div>
      )}

      {/* Location list sidebar */}
      {geoLocations.length > 0 && (
        <div className="absolute right-0 top-0 z-[1000] flex h-full w-[280px] flex-col border-l border-[#2a3347] bg-[#141820]/95 backdrop-blur-sm">
          <div className="border-b border-[#2a3347] px-4 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#6272a4]">
            Locations ({geoLocations.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {geoLocations.map((loc) => (
              <button
                key={loc.name}
                type="button"
                className="flex w-full items-start gap-2.5 border-b border-[#2a3347]/50 px-4 py-2.5 text-left transition hover:bg-[#1e2840]"
                onClick={() => {
                  mapRef.current?.setView([loc.lat, loc.lon], 10, { animate: true });
                }}
              >
                <div
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ background: loc.kind === "border" ? "#4af0b0" : "#5b8dff" }}
                />
                <div className="min-w-0">
                  <div className="truncate text-[0.68rem] font-semibold text-[#cdd6f4]">{loc.name}</div>
                  <div className="truncate text-[0.58rem] text-[#6272a4]">{loc.displayName}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
