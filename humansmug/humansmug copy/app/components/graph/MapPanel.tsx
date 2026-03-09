"use client";

import type { Feature, GeoJsonObject, Geometry, Position } from "geojson";
import type L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EdgeMeta, NodeMeta } from "@/app/lib/graph/types";

type MapPanelProps = {
  nodeMetaMap: Record<string, NodeMeta>;
  edgeMetaMap: Record<string, EdgeMeta>;
  isActive: boolean;
};

type GeoLocation = {
  name: string;
  displayName: string;
  kind: "pin" | "border";
  lat?: number;
  lon?: number;
  geojson?: GeoJsonObject;
  center?: [number, number];
};

type RouteGeometry = {
  id: string;
  path: Array<[number, number]>;
};

type NominatimResult = {
  display_name: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  geojson?: GeoJsonObject;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function computeGeoJsonCenter(geojson: GeoJsonObject): [number, number] | null {
  const coords: Position[] = [];
  const collect = (positions: Position[]) => {
    for (const pos of positions) {
      coords.push(pos);
    }
  };

  const walk = (geometry: Geometry | null) => {
    if (!geometry) return;
    switch (geometry.type) {
      case "Point":
        coords.push(geometry.coordinates);
        break;
      case "MultiPoint":
      case "LineString":
        collect(geometry.coordinates);
        break;
      case "MultiLineString":
      case "Polygon":
        geometry.coordinates.forEach(collect);
        break;
      case "MultiPolygon":
        geometry.coordinates.flat(1).forEach(collect);
        break;
      case "GeometryCollection":
        geometry.geometries.forEach(walk);
        break;
      default:
        break;
    }
  };

  if ("type" in geojson && geojson.type === "FeatureCollection") {
    geojson.features.forEach((feature) => walk(feature.geometry));
  } else if ("type" in geojson && geojson.type === "Feature") {
    walk((geojson as Feature).geometry);
  } else {
    walk(geojson as Geometry);
  }

  if (coords.length === 0) {
    return null;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const [lon, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

export default function MapPanel({ nodeMetaMap, edgeMetaMap, isActive }: MapPanelProps) {
  const [geoLocations, setGeoLocations] = useState<GeoLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [routeGeometries, setRouteGeometries] = useState<RouteGeometry[]>([]);
  const fetchedRef = useRef<Record<string, GeoLocation>>({});
  const routeCacheRef = useRef<Record<string, RouteGeometry>>({});
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initAttemptsRef = useRef(0);

  const ensureMapReady = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) {
      if (initAttemptsRef.current < 40) {
        initAttemptsRef.current += 1;
        setTimeout(() => {
          void ensureMapReady();
        }, 100);
      } else if (!error) {
        setError("Map container has zero size; try resizing or switching tabs.");
      }
      return;
    }

    let L: typeof import("leaflet");
    try {
      L = leafletRef.current || (await import("leaflet"));
      leafletRef.current = L;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Leaflet. Check console for details.",
      );
      return;
    }

    delete (L.Icon.Default as unknown as { prototype?: { _getIconUrl?: unknown } }).prototype
      ?._getIconUrl;
    L.Icon.Default.mergeOptions({
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
        return;
      }
    }

    mapRef.current = L.map(container, {
      zoomControl: true,
      preferCanvas: true,
    }).setView([32.5, -99.5], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      crossOrigin: true,
    }).addTo(mapRef.current);

    layerGroupRef.current = L.layerGroup().addTo(mapRef.current);
    mapRef.current.invalidateSize();
    if (error) setError(null);
  }, []);

  useEffect(() => {
    setIsClient(true);
    let resizeObserver: ResizeObserver | null = null;
    initAttemptsRef.current = 0;
    void ensureMapReady();

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
    void ensureMapReady();
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
      Object.values(nodeMetaMap).filter((node) =>
        locationCategories.has(node.category.toUpperCase()),
      ),
    [nodeMetaMap, locationCategories],
  );

  const nonLocationNodes = useMemo(
    () =>
      Object.values(nodeMetaMap).filter(
        (node) => !locationCategories.has(node.category.toUpperCase()),
      ),
    [nodeMetaMap, locationCategories],
  );

  useEffect(() => {
    if (locations.length === 0) {
      setGeoLocations([]);
      return;
    }

    let isCancelled = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      const results: GeoLocation[] = [];

      for (const location of locations) {
        const key = normalizeText(location.name);
        if (fetchedRef.current[key]) {
          results.push(fetchedRef.current[key]);
          continue;
        }

        try {
          const query = encodeURIComponent(location.name);
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&addressdetails=1&q=${query}`,
            {
              headers: { "Accept-Language": "en" },
            },
          );
          if (!response.ok) {
            throw new Error(`Nominatim error ${response.status}`);
          }
          const payload = (await response.json()) as NominatimResult[];
          const first = payload[0];
          if (!first) {
            continue;
          }

          const hasPolygon =
            first.geojson && ["Polygon", "MultiPolygon"].includes(first.geojson.type);
          const lat = first.lat ? Number.parseFloat(first.lat) : undefined;
          const lon = first.lon ? Number.parseFloat(first.lon) : undefined;
          const center =
            first.geojson && hasPolygon ? computeGeoJsonCenter(first.geojson) : undefined;

          const item: GeoLocation = {
            name: location.name,
            displayName: first.display_name,
            kind: hasPolygon ? "border" : "pin",
            lat,
            lon,
            geojson: hasPolygon ? first.geojson : undefined,
            center: center || (lat && lon ? [lat, lon] : undefined),
          };
          fetchedRef.current[key] = item;
          results.push(item);
        } catch (err) {
          if (!isCancelled) {
            setError(err instanceof Error ? err.message : "Failed to load geocoding");
          }
        }
      }

      if (!isCancelled) {
        setGeoLocations(results);
        setIsLoading(false);
      }
    };

    void run();
    return () => {
      isCancelled = true;
    };
  }, [locations]);

  const locationCenters = useMemo(
    () =>
      geoLocations
        .map((loc) => loc.center)
        .filter((center): center is [number, number] => Boolean(center)),
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
      if (!source?.center || !target?.center) continue;
      lines.push({
        id: edge.id,
        path: [source.center, target.center],
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
          // Fallback: use straight line between endpoints.
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

  useEffect(() => {
    const L = leafletRef.current;
    if (!L || !mapRef.current || !layerGroupRef.current) return;
    layerGroupRef.current.clearLayers();

    for (const loc of geoLocations) {
      if (loc.geojson) {
        L.geoJSON(loc.geojson, {
          style: {
            color: "#4af0b0",
            weight: 2,
            fillColor: "#4af0b0",
            fillOpacity: 0.15,
          },
        }).addTo(layerGroupRef.current);
      } else if (loc.lat && loc.lon) {
        L.marker([loc.lat, loc.lon]).addTo(layerGroupRef.current);
      }
    }

    const routesToDraw = routeGeometries.length ? routeGeometries : routeLines;
    for (const line of routesToDraw) {
      L.polyline(line.path, {
        color: "#5b8dff",
        weight: 4,
        opacity: 0.7,
      }).addTo(layerGroupRef.current);
    }

    if (locationCenters.length > 0) {
      mapRef.current.fitBounds(locationCenters, { padding: [30, 30] });
    }
  }, [geoLocations, routeLines, routeGeometries, locationCenters]);

  return (
    <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
      <div className="rounded-2xl border border-[#2a3347] bg-[#141820] p-4">
        <div className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
          Map Overlay
        </div>
        <div className="relative min-h-[360px] overflow-hidden rounded-xl border border-[#2a3347]">
          {!isClient ? (
            <div className="flex h-[360px] w-full items-center justify-center text-[0.72rem] text-[#6272a4]">
              Loading map…
            </div>
          ) : (
            <div ref={containerRef} className="h-[360px] w-full" style={{ minHeight: 360 }} />
          )}
          <div className="absolute left-3 top-3 rounded-md border border-[#2a3347] bg-[#0d0f14]/85 px-2 py-1 text-[0.62rem] text-[#cdd6f4]">
            Pins: {geoLocations.filter((loc) => loc.kind === "pin").length} • Borders:{" "}
            {geoLocations.filter((loc) => loc.kind === "border").length}
          </div>
        </div>
        {isLoading ? (
          <div className="mt-3 text-[0.7rem] text-[#6272a4]">Loading OSM geocoding…</div>
        ) : null}
        {error ? (
          <div className="mt-2 text-[0.7rem] text-[#ff6b6b]">Geocoding error: {error}</div>
        ) : null}
        <div className="mt-2 text-[0.68rem] text-[#6272a4]">
          Location nodes are converted to pins or borders based on OSM geocoding results.
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-4">
          <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
            Geocoded Locations
          </div>
          {geoLocations.length === 0 ? (
            <div className="text-[0.7rem] text-[#6272a4]">No location nodes yet.</div>
          ) : (
            <ul className="space-y-2 text-[0.72rem] text-[#cdd6f4]">
              {geoLocations.map((loc) => (
                <li key={loc.name} className="rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2">
                  <div className="font-semibold">
                    {loc.name} <span className="text-[0.62rem] text-[#6272a4]">({loc.kind})</span>
                  </div>
                  <div className="text-[0.68rem] text-[#6272a4]">{loc.displayName}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-4">
          <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
            Non-Location Nodes
          </div>
          {nonLocationNodes.length === 0 ? (
            <div className="text-[0.7rem] text-[#6272a4]">No other nodes yet.</div>
          ) : (
            <ul className="space-y-2 text-[0.72rem] text-[#cdd6f4]">
              {nonLocationNodes.map((node) => (
                <li key={node.name} className="rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2">
                  <div className="font-semibold">{node.name}</div>
                  <div className="text-[0.68rem] text-[#6272a4]">{node.category}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
