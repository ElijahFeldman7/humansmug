"use client";

import { JetBrains_Mono, Syne } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DetailPanel } from "@/app/components/graph/DetailPanel";
import { EntityList } from "@/app/components/graph/EntityList";
import { GraphCanvas } from "@/app/components/graph/GraphCanvas";
import { HeaderStats } from "@/app/components/graph/HeaderStats";
import { Legend } from "@/app/components/graph/Legend";
import dynamic from "next/dynamic";

import { Toast } from "@/app/components/graph/Toast";
import { useVisNetwork } from "@/app/hooks/useVisNetwork";
import { parseTuples } from "@/app/lib/graph/parseTuples";

import { computeCentrality, type CentralityKind } from "@/app/lib/graph/centrality";
import { computeCommunities } from "@/app/lib/graph/community";
import type { DetailState, EdgeMeta, NodeMeta } from "@/app/lib/graph/types";

type RightPanelMode = "agent" | "upload" | "stats" | "osint";

type OsintCandidate = {
  name: string;
  category: string;
  desc: string;
  edgeCount: number;
  centrality: number;
  thinness: number;
};

type OsintTask = {
  id: string;
  status: string;
  entities: OsintCandidate[];
  createdAt: string;
  totalCost?: number;
  opportunityId?: string;
  dashboardUrl?: string;
};

const MapPanel = dynamic(() => import("@/app/components/graph/MapPanel"), { ssr: false });
const GRAPH_STORAGE_KEY = "humansmug:lastGraph:v1";
const AGENT_STORAGE_KEY = "humansmug:agentChat:v1";

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-jetbrains",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-syne",
});

export default function Home() {
  const networkElementRef = useRef<HTMLDivElement | null>(null);
  const nodeMetaMapRef = useRef<Record<string, NodeMeta>>({});
  const edgeMetaMapRef = useRef<Record<string, EdgeMeta>>({});
  const evidenceMapRef = useRef<Record<string, string>>({});
  const toastTimerRef = useRef<number | null>(null);

  const { renderNetwork, fitGraph, focusNode, togglePhysics, setHighlight } = useVisNetwork(networkElementRef);


  const [docFiles, setDocFiles] = useState<FileList | null>(null);
  const [isProcessingDocs, setIsProcessingDocs] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [nodeMetaMap, setNodeMetaMap] = useState<Record<string, NodeMeta>>({});
  const [edgeMetaMap, setEdgeMetaMap] = useState<Record<string, EdgeMeta>>({});
  const [evidenceMap, setEvidenceMap] = useState<Record<string, string>>({});
  const [nodesCount, setNodesCount] = useState(0);
  const [edgesCount, setEdgesCount] = useState(0);
  const [legendTypes, setLegendTypes] = useState<string[]>([]);
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<DetailState>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [hasGraph, setHasGraph] = useState(false);
  const [lastGraphRaw, setLastGraphRaw] = useState("");
  const didRestoreRef = useRef(false);
  const [agentInput, setAgentInput] = useState("");
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [agentMessages, setAgentMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [rankingMode, setRankingMode] = useState<CentralityKind>("degree");
  const [minClosenessDegree, setMinClosenessDegree] = useState(2);
  const [rankingsEnabled, setRankingsEnabled] = useState(true);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [communities, setCommunities] = useState<Array<{ id: number; nodes: string[]; size: number }>>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState<number | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("upload");
  const [sidebarSection, setSidebarSection] = useState<"detail" | "entities" | "ranking" | "subgroups">("detail");
  const [showSettings, setShowSettings] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [osintCandidates, setOsintCandidates] = useState<OsintCandidate[]>([]);
  const [osintTasks, setOsintTasks] = useState<OsintTask[]>([]);
  const [osintAnalyzing, setOsintAnalyzing] = useState(false);
  const [osintCreating, setOsintCreating] = useState(false);
  const [osintSelected, setOsintSelected] = useState<Set<string>>(new Set());
  const agentMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const renderGraph = useCallback(
    (rawInput: string, evidenceOverride?: Record<string, string>) => {
      if (!networkElementRef.current) {
        showToast("Graph library still loading...");
        return;
      }

      const raw = rawInput.trim();
      if (!raw) {
        showToast("Model output was empty");
        return;
      }

      const { nodes, edges, nodeMetaMap, edgeMetaMap } = parseTuples(raw);
      const norm = (value: string) =>
        value.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
      const activeEvidenceMap = evidenceOverride ?? evidenceMapRef.current;
      Object.values(edgeMetaMap).forEach((edge) => {
        const key = `${norm(edge.source)}||${norm(edge.target)}||${norm(edge.label)}`;
        if (activeEvidenceMap[key]) {
          edge.evidence = activeEvidenceMap[key];
        }
      });
      if (nodes.length === 0) {
        showToast("No entities found - model output format may be invalid");
        return;
      }

      nodeMetaMapRef.current = nodeMetaMap;
      edgeMetaMapRef.current = edgeMetaMap;
      setNodeMetaMap(nodeMetaMap);
      setEdgeMetaMap(edgeMetaMap);
      setSelectedCommunityId(null);
      const communityResult = computeCommunities(
        nodes.map((node) => node.id),
        Object.values(edgeMetaMap),
      );
      setCommunities(communityResult.communities);

      const networkReady = renderNetwork(nodes, edges, {
        onSelectNode: (id) => {
          const meta = nodeMetaMapRef.current[id];
          if (meta) {
            setDetail({ kind: "node", data: meta });
            setSidebarSection("detail");
          }
        },
        onSelectEdge: (id) => {
          const meta = edgeMetaMapRef.current[id];
          if (meta) {
            setDetail({ kind: "edge", data: meta });
            setSidebarSection("detail");
          }
        },
        onClearDetail: () => setDetail(null),
      });

      if (!networkReady) {
        showToast("Graph container is not ready yet");
        return;
      }

      setNodesCount(nodes.length);
      setEdgesCount(edges.length);
      setEntityIds(nodes.map((node) => node.id));
      setLegendTypes(
        Array.from(new Set(nodes.map((node) => nodeMetaMap[node.id]?.category || "DEFAULT"))),
      );
      setHasGraph(true);
      setLastGraphRaw(raw);
      setDetail(null);
    },
    [renderNetwork, showToast],
  );

  const renderOnDiagram = useCallback(
    (rawInput: string) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => renderGraph(rawInput));
      });
    },
    [renderGraph],
  );

  const handleProcessDocs = useCallback(async () => {
    if (!docFiles || docFiles.length === 0) {
      showToast("Select docx or CSV files first");
      return;
    }
    setIsProcessingDocs(true);
    setProcessStatus("Uploading and extracting blurbs...");
    try {
      const form = new FormData();
      Array.from(docFiles).forEach((file) => form.append("files", file));
      form.append("blurbSize", "2");
      form.append("applyFilter", "true");

      const response = await fetch("/api/process-docs", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        mergedTuples?: string;
        blurbCount?: number;
        tupleCount?: number;
        evidenceMap?: Record<string, string>;
        error?: string;
      };

      if (!response.ok || !payload.mergedTuples) {
        throw new Error(payload.error || "Failed to process documents");
      }
      setProcessStatus(
        `Processed ${payload.blurbCount || 0} blurbs into ${payload.tupleCount || 0} tuples. Saved in local storage.`,
      );
      setEvidenceMap(payload.evidenceMap || {});
      renderOnDiagram(payload.mergedTuples);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setProcessStatus(`Failed: ${message}`);
      showToast(`Processing failed: ${message}`);
    } finally {
      setIsProcessingDocs(false);
    }
  }, [docFiles, renderOnDiagram, showToast]);

  const resolveNodeId = useCallback((name: string): string | null => {
    if (nodeMetaMapRef.current[name]) return name;
    const upper = name.toUpperCase().trim();
    for (const key of Object.keys(nodeMetaMapRef.current)) {
      if (key.toUpperCase().trim() === upper) return key;
    }
    const norm = upper.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
    for (const key of Object.keys(nodeMetaMapRef.current)) {
      const keyNorm = key.toUpperCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
      if (keyNorm === norm) return key;
    }
    return null;
  }, []);

  const handleFocusNode = useCallback(
    (id: string) => {
      const resolved = resolveNodeId(id);
      if (!resolved) {
        showToast(`Node "${id}" not found`);
        return;
      }
      focusNode(resolved);
      const meta = nodeMetaMapRef.current[resolved];
      if (meta) {
        setDetail({ kind: "node", data: meta });
        setSidebarSection("detail");
      }
    },
    [focusNode, resolveNodeId, showToast],
  );

  const handleTogglePhysics = useCallback(() => {
    const nextState = togglePhysics();
    if (nextState === null) {
      showToast("Render a graph first");
      return;
    }
    if (nextState === false) {
      showToast("Physics OFF");
      return;
    }
    showToast("Physics ON");
  }, [showToast, togglePhysics]);

  const handleNetworkMount = useCallback((node: HTMLDivElement | null) => {
    networkElementRef.current = node;
  }, []);

  // In the new layout, graph is always visible — no tab switching needed
  const jumpToNode = useCallback(
    (name: string) => {
      handleFocusNode(name);
    },
    [handleFocusNode],
  );

  const jumpToEdge = useCallback(
    (edge: EdgeMeta) => {
      setDetail({ kind: "edge", data: edge });
      setSidebarSection("detail");
      if (edge.source) {
        handleFocusNode(edge.source);
      }
    },
    [handleFocusNode],
  );

  useEffect(() => {
    if (selectedCommunityId === null) {
      setHighlight(null);
      return;
    }
    const community = communities.find((c) => c.id === selectedCommunityId);
    if (!community) {
      setHighlight(null);
      return;
    }
    setHighlight(new Set(community.nodes));
  }, [communities, selectedCommunityId, setHighlight]);

  const edgeStats = useMemo(() => {
    const edges = Object.values(edgeMetaMap);
    if (edges.length === 0) {
      return {
        mean: 0,
        std: 0,
        threshold: 0,
        outliers: [] as Array<EdgeMeta & { z: number }>,
      };
    }
    const mean = edges.reduce((sum, edge) => sum + edge.strength, 0) / edges.length;
    const variance =
      edges.reduce((sum, edge) => sum + (edge.strength - mean) ** 2, 0) / edges.length;
    const std = Math.sqrt(variance);
    const threshold = mean + std * 1.25;
    const outliers = edges
      .map((edge) => ({ ...edge, z: std === 0 ? 0 : (edge.strength - mean) / std }))
      .filter((edge) => edge.strength >= threshold)
      .sort((a, b) => b.strength - a.strength);
    return { mean, std, threshold, outliers };
  }, [edgeMetaMap]);

  const handleAgentSend = useCallback(async () => {
    const message = agentInput.trim();
    if (!message) return;
    setAgentInput("");
    setAgentMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsAgentBusy(true);
    try {
      const nodes = Object.values(nodeMetaMapRef.current);
      const edges = Object.values(edgeMetaMapRef.current);
      const nodeIds = Object.keys(nodeMetaMapRef.current);

      // Compute all four centrality measures
      const degreeCentrality = computeCentrality(nodeIds, edges, "degree");
      const closenessCentrality = computeCentrality(nodeIds, edges, "closeness");
      const eigenvectorCentrality = computeCentrality(nodeIds, edges, "eigenvector");
      const betweennessCentrality = computeCentrality(nodeIds, edges, "betweenness");

      const analytics = {
        centrality: {
          degree: degreeCentrality,
          closeness: closenessCentrality,
          eigenvector: eigenvectorCentrality,
          betweenness: betweennessCentrality,
        },
        communities: communities.map((c, i) => ({
          groupIndex: i + 1,
          nodes: c.nodes,
          size: c.size,
        })),
        edgeStats: {
          mean: edgeStats.mean,
          std: edgeStats.std,
          outlierThreshold: edgeStats.threshold,
          outliers: edgeStats.outliers.map((o) => ({
            source: o.source,
            target: o.target,
            label: o.label,
            strength: o.strength,
            zScore: o.z,
          })),
        },
      };

      const response = await fetch("/api/graph-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, nodes, edges, analytics }),
      });
      const payload = (await response.json()) as { output?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Agent request failed");
      }
      setAgentMessages((prev) => [
        ...prev,
        { role: "assistant", content: payload.output || "No response returned." },
      ]);
    } catch (error) {
      const err = error instanceof Error ? error.message : "Unknown error";
      showToast(`Agent failed: ${err}`);
      setAgentMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I hit an error. Try again." },
      ]);
    } finally {
      setIsAgentBusy(false);
    }
  }, [agentInput, showToast, communities, edgeStats]);

  // OSINT: analyze graph for thin entities
  const handleOsintAnalyze = useCallback(async () => {
    setOsintAnalyzing(true);
    try {
      const nodes = Object.values(nodeMetaMapRef.current);
      const edges = Object.values(edgeMetaMapRef.current);
      const nodeIds = Object.keys(nodeMetaMapRef.current);
      const centrality = computeCentrality(nodeIds, edges, "betweenness");

      const res = await fetch("/api/terac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          nodes: nodes.map((n) => ({
            name: n.name,
            category: n.category,
            desc: n.desc,
            descs: n.descs,
          })),
          edges: edges.map((e) => ({
            source: e.source,
            target: e.target,
            label: e.label,
            strength: e.strength,
          })),
          centrality,
        }),
      });
      const data = (await res.json()) as { candidates?: OsintCandidate[] };
      setOsintCandidates(data.candidates || []);
      // Auto-select top 5
      const top5 = (data.candidates || []).slice(0, 5).map((c) => c.name);
      setOsintSelected(new Set(top5));
    } catch (err) {
      showToast(`OSINT analysis failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setOsintAnalyzing(false);
    }
  }, [showToast]);

  // OSINT: create Terac task for selected entities
  const handleOsintCreate = useCallback(async () => {
    const selected = osintCandidates.filter((c) => osintSelected.has(c.name));
    if (selected.length === 0) return;
    setOsintCreating(true);
    try {
      const res = await fetch("/api/terac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          entities: selected,
          taskType: "osint",
        }),
      });
      const data = (await res.json()) as {
        taskId?: string;
        status?: string;
        dashboardUrl?: string;
        totalCost?: number;
        opportunityId?: string;
        error?: string;
        note?: string;
      };
      if (data.taskId) {
        const newTask: OsintTask = {
          id: data.taskId,
          status: data.status || "pending",
          entities: selected,
          createdAt: new Date().toISOString(),
          totalCost: data.totalCost,
          opportunityId: data.opportunityId,
          dashboardUrl: data.dashboardUrl,
        };
        setOsintTasks((prev) => [newTask, ...prev]);
        setOsintCandidates([]);
        setOsintSelected(new Set());
        showToast(data.note || `OSINT task created: ${data.taskId.slice(-8)}`);
      } else {
        showToast(data.error || "Failed to create task");
      }
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setOsintCreating(false);
    }
  }, [osintCandidates, osintSelected, showToast]);

  const handleOsintRefresh = useCallback(async () => {
    try {
      const res = await fetch("/api/terac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const data = (await res.json()) as { tasks?: OsintTask[] };
      if (data.tasks) setOsintTasks(data.tasks);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    agentMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentMessages]);

  const normalizeKey = useCallback((value: string) => {
    return value.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  }, []);

  const cleanNodeName = useCallback((value: string) => {
    return value.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  }, []);

  const decodeTokenValue = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const convertAgentTokens = useCallback((content: string) => {
    let result = content;

    result = result.replace(/\[\[NODE:([^\]]+)\]\]/g, (_match, rawName: string) => {
      const name = rawName.trim();
      return `[NODE:${name}](node:${encodeURIComponent(name)})`;
    });

    result = result.replace(/\[\[EDGE:([^\]]+)\]\]/g, (_match, rawEdge: string) => {
      const cleaned = rawEdge.trim();
      const arrowSplit = cleaned.split("|").map((part) => part.trim());
      if (arrowSplit.length >= 2 && arrowSplit[0].includes("->")) {
        const [left, right] = arrowSplit[0].split("->").map((part) => part.trim());
        const label = arrowSplit.slice(1).join(" | ").trim();
        const link = `${left}|${right}|${label}`;
        return `[EDGE:${cleaned}](edge:${encodeURIComponent(link)})`;
      }
      return `[EDGE:${cleaned}](edge:${encodeURIComponent(cleaned)})`;
    });

    // Catch bare NODE:NAME not already inside [NODE:...](node:...) links
    // Match uppercase words (possibly multi-word, with hyphens) after NODE:
    result = result.replace(/(^|[^[(])NODE:([A-Z][A-Z0-9-]+(?:\s+[A-Z][A-Z0-9-]+)*)/gm, (_match, prefix: string, rawName: string) => {
      const name = rawName.trim().replace(/[.,]+$/, "");
      if (!name) return _match;
      return `${prefix}[NODE:${name}](node:${encodeURIComponent(name)})`;
    });

    // Catch bare EDGE:... not already inside links
    result = result.replace(/(^|[^[(])EDGE:([^\n\]\)]+?)(?=([.,;:)\n]|$))/gm, (_match, prefix: string, rawEdge: string) => {
      const cleaned = rawEdge.trim();
      const arrowSplit = cleaned.split("|").map((part) => part.trim());
      if (arrowSplit.length >= 2 && arrowSplit[0].includes("->")) {
        const [left, right] = arrowSplit[0].split("->").map((part) => part.trim());
        const label = arrowSplit.slice(1).join(" | ").trim();
        const link = `${left}|${right}|${label}`;
        return `${prefix}[EDGE:${cleaned}](edge:${encodeURIComponent(link)})`;
      }
      return `${prefix}[EDGE:${cleaned}](edge:${encodeURIComponent(cleaned)})`;
    });

    result = result.replace(
      /\[([^\]]+)\]\((?!node:|edge:|https?:\/\/)([a-z_]+):([^)]+)\)/gi,
      (_match, _linkText: string, _prefix: string, name: string) => {
        const cleanedName = name.trim();
        return `[NODE:${cleanedName}](node:${encodeURIComponent(cleanedName)})`;
      },
    );

    // Catch [NODE:NAME] without (node:...) part — add the link target
    result = result.replace(/\[NODE:([^\]]+)\](?!\()/g, (_match, rawName: string) => {
      const name = rawName.trim();
      return `[NODE:${name}](node:${encodeURIComponent(name)})`;
    });

    // Catch [EDGE:...] without (edge:...) part
    result = result.replace(/\[EDGE:([^\]]+)\](?!\()/g, (_match, rawEdge: string) => {
      const cleaned = rawEdge.trim();
      return `[EDGE:${cleaned}](edge:${encodeURIComponent(cleaned)})`;
    });

    // Encode unencoded node/edge URLs so ReactMarkdown can parse them
    // (LLM may output raw spaces/pipes in the URL portion)
    result = result.replace(/\]\(node:([^)]+)\)/g, (_match, rawUrl: string) => {
      if (rawUrl.includes("%")) return _match;
      return `](node:${encodeURIComponent(rawUrl)})`;
    });
    result = result.replace(/\]\(edge:([^)]+)\)/g, (_match, rawUrl: string) => {
      if (rawUrl.includes("%")) return _match;
      return `](edge:${encodeURIComponent(rawUrl)})`;
    });

    return result;
  }, []);

  useEffect(() => {
    evidenceMapRef.current = evidenceMap;
  }, [evidenceMap]);

  useEffect(() => {
    const saved = window.localStorage.getItem(AGENT_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Array<{ role: "user" | "assistant"; content: string }>;
      if (Array.isArray(parsed)) {
        setAgentMessages(parsed.slice(-50));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    if (!agentMessages.length) return;
    window.localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(agentMessages.slice(-50)));
  }, [agentMessages]);

  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    const saved = window.localStorage.getItem(GRAPH_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        raw?: string;
        evidenceMap?: Record<string, string>;
      };
      if (!parsed.raw) return;
      if (parsed.evidenceMap) {
        setEvidenceMap(parsed.evidenceMap);
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renderGraph(parsed.raw as string, parsed.evidenceMap);
        });
      });
    } catch {
      // ignore malformed storage
    }

    const handleWindowError = (event: ErrorEvent) => {
      if (event.message && event.message.includes("ResizeObserver loop")) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };

    window.addEventListener("error", handleWindowError);

    return () => {
      window.removeEventListener("error", handleWindowError);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [renderGraph]);

  useEffect(() => {
    if (!lastGraphRaw) return;
    const payload = JSON.stringify({
      raw: lastGraphRaw,
      evidenceMap,
    });
    window.localStorage.setItem(GRAPH_STORAGE_KEY, payload);
  }, [lastGraphRaw, evidenceMap]);

  const rankingScores = useMemo(() => {
    const nodeIds = Object.keys(nodeMetaMap);
    if (!rankingsEnabled || !nodeIds.length) return {};
    return computeCentrality(nodeIds, Object.values(edgeMetaMap), rankingMode, {
      minDegree: rankingMode === "closeness" ? minClosenessDegree : 0,
    });
  }, [edgeMetaMap, nodeMetaMap, rankingMode, minClosenessDegree, rankingsEnabled]);

  const rankedNodes = useMemo(() => {
    return Object.keys(rankingScores)
      .map((id) => ({ id, score: rankingScores[id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }, [rankingScores]);

  /* ─── Agent link renderer (shared) ─── */
  const agentLinkComponents = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        const safeHref = String(href || "");
        if (safeHref.startsWith("node:")) {
          const raw = cleanNodeName(decodeTokenValue(safeHref.slice(5)));
          return (
            <button
              type="button"
              onClick={() => jumpToNode(raw)}
              className="inline-flex items-center gap-1 rounded-full border border-[#4af0b0] bg-[#102018] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#4af0b0] hover:border-[#6ff5be] hover:text-[#6ff5be]"
            >
              {children}
            </button>
          );
        }
        if (safeHref.startsWith("edge:")) {
          const raw = decodeTokenValue(safeHref.slice(5));
          const parts = raw.split("|").map((part) => part.trim());
          let source = "";
          let target = "";
          let label = "";
          if (parts.length >= 3) {
            [source, target] = parts;
            label = parts.slice(2).join(" | ").trim();
          } else if (parts.length === 2 && parts[0].includes("->")) {
            const [left, right] = parts[0].split("->").map((part) => part.trim());
            source = left || "";
            target = right || "";
            label = parts[1] || "";
          } else if (parts.length === 1 && parts[0].includes("->")) {
            const [left, right] = parts[0].split("->").map((part) => part.trim());
            source = left || "";
            target = right || "";
            label = "";
          }
          source = cleanNodeName(source);
          target = cleanNodeName(target);
          return (
            <button
              type="button"
              onClick={() => {
                const edges = Object.values(edgeMetaMapRef.current);
                let edge = edges.find((item) => {
                  return (
                    normalizeKey(item.source) === normalizeKey(source) &&
                    normalizeKey(item.target) === normalizeKey(target) &&
                    normalizeKey(item.label) === normalizeKey(label)
                  );
                });
                if (!edge && source && target) {
                  edge = edges.find((item) => {
                    return (
                      normalizeKey(item.source) === normalizeKey(source) &&
                      normalizeKey(item.target) === normalizeKey(target)
                    );
                  });
                }
                if (edge) {
                  jumpToEdge(edge);
                } else {
                  showToast("Edge not found in current graph");
                }
              }}
              className="inline-flex items-center gap-1 rounded-full border border-[#5b8dff] bg-[#0f1628] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#5b8dff] hover:border-[#7aa4ff] hover:text-[#7aa4ff]"
            >
              {children}
            </button>
          );
        }
        return (
          <a href={safeHref} className="text-[#5b8dff] hover:text-[#7aa4ff]">
            {children}
          </a>
        );
      },
    }),
    [jumpToNode, jumpToEdge, cleanNodeName, normalizeKey, showToast],
  );

  /* ─── Right panel icon tabs ─── */
  const panelTabs: Array<{ key: RightPanelMode; label: string; icon: React.ReactNode }> = [
    {
      key: "upload",
      label: "CSV Upload",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[14px]">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      ),
    },
  ];

  /* ─── Sidebar tab items ─── */
  const sidebarTabs: Array<{ key: typeof sidebarSection; label: string }> = [
    { key: "detail", label: "Details" },
    { key: "entities", label: "Entities" },
    { key: "ranking", label: "Ranking" },
    { key: "subgroups", label: "Groups" },
  ];

  return (
    <div
      className={`h-dvh overflow-hidden bg-[#0d0f14] text-[#cdd6f4] [font-family:var(--font-jetbrains)] ${jetBrainsMono.variable} ${syne.variable}`}
    >
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
        {/* ─── Header ─── */}
        <div className="flex items-center border-b border-[#2a3347] bg-[#141820] px-5 py-2.5">
          <HeaderStats nodesCount={nodesCount} edgesCount={edgesCount} />
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="ml-3 grid size-[30px] place-items-center rounded-lg border border-[#2a3347] text-[#6272a4] transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
            title="Map View"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[14px]">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            className="ml-1.5 grid size-[30px] place-items-center rounded-lg border border-[#2a3347] text-[#6272a4] transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[14px]">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 md:grid-cols-[1fr_380px]">
          <div className="relative flex min-h-0 min-w-0">
            {/* Sidebar */}
            <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-[#2a3347] bg-[#141820]">
              {/* Sidebar tab bar */}
              <div className="flex border-b border-[#2a3347]">
                {sidebarTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSidebarSection(tab.key)}
                    className={`flex-1 px-1 py-2 text-[0.6rem] font-bold uppercase tracking-[0.1em] transition ${
                      sidebarSection === tab.key
                        ? "border-b-2 border-[#4af0b0] text-[#4af0b0]"
                        : "text-[#6272a4] hover:text-[#cdd6f4]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sidebar content */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {sidebarSection === "detail" && (
                  <div className="p-0">
                    <DetailPanel
                      detail={detail}
                      forceOpen
                      emptyLabel="Click a node or edge on the graph."
                      onFocusNode={handleFocusNode}
                    />
                  </div>
                )}

                {sidebarSection === "entities" && (
                  <div className="px-2 py-2">
                    <EntityList
                      entityIds={entityIds}
                      nodeMetaMap={nodeMetaMap}
                      onFocusNode={handleFocusNode}
                    />
                  </div>
                )}

                {sidebarSection === "ranking" && (
                  <div className="px-3 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[0.6rem] uppercase tracking-[0.1em] text-[#6272a4]">{rankingMode}</span>
                      <select
                        value={rankingMode}
                        onChange={(e) => setRankingMode(e.target.value as CentralityKind)}
                        className="rounded border border-[#2a3347] bg-[#0d0f14] px-2 py-1 text-[0.6rem] text-[#cdd6f4] outline-none"
                      >
                        <option value="degree">Degree</option>
                        <option value="closeness">Closeness</option>
                        <option value="eigenvector">Eigenvector</option>
                        <option value="betweenness">Betweenness</option>
                      </select>
                    </div>
                    {!rankingsEnabled ? (
                      <div className="rounded-md border border-dashed border-[#2a3347] bg-[#0d0f14] px-3 py-3 text-[0.65rem] text-[#6272a4]">
                        Rankings disabled in Settings.
                      </div>
                    ) : rankedNodes.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[#2a3347] bg-[#0d0f14] px-3 py-3 text-[0.65rem] text-[#6272a4]">
                        Render a graph to compute rankings.
                      </div>
                    ) : (
                      <ul className="space-y-1.5 text-[0.7rem] text-[#cdd6f4]">
                        {rankedNodes.map((item, index) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => handleFocusNode(item.id)}
                              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[#2a3347] bg-[#0d0f14] px-2.5 py-2 text-left transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {index + 1}. {item.id}
                              </span>
                              <span className="ml-2 shrink-0 text-[0.65rem] tabular-nums text-[#6272a4]">
                                {item.score.toFixed(3)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {sidebarSection === "subgroups" && (
                  <div className="px-3 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[0.6rem] uppercase tracking-[0.1em] text-[#6272a4]">Communities</span>
                      <button
                        type="button"
                        onClick={() => setSelectedCommunityId(null)}
                        className="text-[0.6rem] uppercase tracking-[0.1em] text-[#9aa6cf] hover:text-[#cdd6f4]"
                      >
                        Clear
                      </button>
                    </div>
                    {communities.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[#2a3347] bg-[#0d0f14] px-3 py-3 text-[0.65rem] text-[#6272a4]">
                        Render a graph to detect communities.
                      </div>
                    ) : (
                      <ul className="space-y-1.5 text-[0.7rem] text-[#cdd6f4]">
                        {communities.map((community, index) => {
                          const active = selectedCommunityId === community.id;
                          return (
                            <li key={`community-${community.id}`}>
                              <button
                                type="button"
                                onClick={() => setSelectedCommunityId(community.id)}
                                className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                                  active
                                    ? "border-[#4af0b0] bg-[#102018] text-[#4af0b0]"
                                    : "border-[#2a3347] bg-[#0d0f14] hover:border-[#5b8dff] hover:text-[#cdd6f4]"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  Group {index + 1}
                                </span>
                                <span className="ml-2 shrink-0 text-[0.65rem] text-[#6272a4]">
                                  {community.size}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </aside>

            {/* Graph canvas */}
            <div className="relative min-h-[360px] flex-1 md:min-h-0">
              <GraphCanvas
                hasGraph={hasGraph}
                networkRef={handleNetworkMount}
                onFitGraph={fitGraph}
                onTogglePhysics={handleTogglePhysics}
              />
              <div
                className={`absolute bottom-4 right-4 z-10 rounded-xl border border-[#2a3347] bg-[#141820]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${
                  legendCollapsed ? "w-auto" : "w-[200px]"
                } overflow-auto`}
                style={{ minWidth: legendCollapsed ? "auto" : 160, minHeight: legendCollapsed ? "auto" : 80 }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[0.6rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                    Legend
                  </div>
                  <button
                    type="button"
                    onClick={() => setLegendCollapsed((prev) => !prev)}
                    className="text-[0.7rem] text-[#9aa6cf] hover:text-[#cdd6f4]"
                  >
                    {legendCollapsed ? "+" : "\u2013"}
                  </button>
                </div>
                {!legendCollapsed ? <Legend types={legendTypes} /> : null}
              </div>
            </div>
          </div>

          {/* ─── RIGHT: Context panel ─── */}
          <div className="flex min-h-0 flex-col border-l border-[#2a3347] bg-[#141820]">
            {/* Panel tab bar */}
            <div className="flex items-center border-b border-[#2a3347]">
              {panelTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setRightPanel(tab.key)}
                  title={tab.label}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[0.6rem] font-bold uppercase tracking-[0.1em] transition ${
                    rightPanel === tab.key
                      ? "border-b-2 border-[#4af0b0] text-[#4af0b0]"
                      : "text-[#6272a4] hover:text-[#cdd6f4]"
                  }`}
                >
                  {tab.icon}
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {/* ─── Agent Chat ─── */}
              {rightPanel === "agent" && (
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    {agentMessages.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#2a3347] bg-[#0d0f14] px-4 py-6 text-[0.72rem] text-[#6272a4]">
                        Ask about entity connections, strongest relationships, or how a node is connected to others.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {agentMessages.map((msg, idx) => (
                          <div
                            key={`${msg.role}-${idx}`}
                            className={`rounded-lg border px-3 py-2 ${
                              msg.role === "user"
                                ? "border-[#5b8dff] bg-[#0f1628] text-[#dbe3ff]"
                                : "border-[#2a3347] bg-[#0d0f14] text-[#cdd6f4]"
                            }`}
                          >
                            <div className="mb-1 text-[0.55rem] uppercase tracking-[0.12em] text-[#6272a4]">
                              {msg.role === "user" ? "You" : "Agent"}
                            </div>
                            {msg.role === "assistant" ? (
                              <div className="max-w-none text-[0.78rem] leading-[1.65] text-[#cdd6f4]">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  urlTransform={(uri) => uri}
                                  components={agentLinkComponents}
                                >
                                  {convertAgentTokens(msg.content)}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap text-[0.78rem]">{msg.content}</div>
                            )}
                          </div>
                        ))}
                        {isAgentBusy && (
                          <div className="flex items-center gap-2 rounded-lg border border-[#2a3347] bg-[#0d0f14] px-4 py-3">
                            <div className="text-[0.55rem] uppercase tracking-[0.12em] text-[#6272a4]">Agent</div>
                            <div className="flex items-center gap-1">
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:0ms]" />
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:150ms]" />
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:300ms]" />
                            </div>
                          </div>
                        )}
                        <div ref={agentMessagesEndRef} />
                      </div>
                    )}
                  </div>
                  <div className="border-t border-[#2a3347] p-3">
                    <div className="flex gap-2">
                      <input
                        value={agentInput}
                        onChange={(event) => setAgentInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void handleAgentSend();
                          }
                        }}
                        placeholder="Ask about the graph..."
                        className="flex-1 rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2 text-[0.75rem] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/70 focus:border-[#5b8dff]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAgentSend()}
                        disabled={isAgentBusy}
                        className="rounded-md bg-[#4af0b0] px-3 py-2 text-[0.7rem] font-bold tracking-[0.06em] text-[#0d0f14] transition hover:bg-[#6ff5be] disabled:cursor-not-allowed disabled:bg-[#2f6f58]"
                      >
                        {isAgentBusy ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Upload ─── */}
              {rightPanel === "upload" && (
                <div className="flex h-full flex-col items-center justify-center px-5">
                  <label className="group flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[#2a3347] bg-[#0d0f14] px-4 py-8 transition hover:border-[#4af0b0]/60">
                    <svg className="size-8 text-[#6272a4] transition group-hover:text-[#4af0b0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
                    </svg>
                    <span className="text-[0.72rem] font-semibold text-[#9aa6cf] transition group-hover:text-[#cdd6f4]">
                      {docFiles && docFiles.length > 0
                        ? `${docFiles.length} file${docFiles.length > 1 ? "s" : ""} selected`
                        : "Choose CSV files"}
                    </span>
                    <input
                      type="file"
                      accept=".csv"
                      multiple
                      className="hidden"
                      onChange={(event) => setDocFiles(event.target.files)}
                    />
                  </label>

                  <div className="mt-4 flex w-full items-center gap-2">
                    <button
                      type="button"
                      onClick={handleProcessDocs}
                      disabled={isProcessingDocs || !docFiles || docFiles.length === 0}
                      className="flex-1 rounded-lg bg-[#4af0b0] py-2.5 text-[0.74rem] font-bold tracking-[0.04em] text-[#0d0f14] transition hover:bg-[#6ff5be] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isProcessingDocs ? "Processing..." : "Process"}
                    </button>
                  </div>

                  {processStatus && (
                    <div className="mt-3 w-full truncate text-center text-[0.65rem] text-[#6272a4]">
                      {processStatus}
                    </div>
                  )}
                </div>
              )}

              {/* ─── Stats / Analysis ─── */}
              {rightPanel === "stats" && (
                <div className="h-full overflow-y-auto px-3 py-4">
                  <div className="rounded-xl border border-[#2a3347] bg-[#0d0f14] p-4">
                    <div className="mb-2 text-[0.66rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                      Relationship Strength
                    </div>
                    <div className="grid gap-1.5 text-[0.72rem] text-[#cdd6f4]">
                      <div>Mean: {edgeStats.mean.toFixed(2)}</div>
                      <div>Std dev: {edgeStats.std.toFixed(2)}</div>
                      <div>Outlier threshold: {edgeStats.threshold.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-[#2a3347] bg-[#0d0f14] p-4">
                    <div className="mb-2 text-[0.66rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                      High-Deviation Relationships
                    </div>
                    {edgeStats.outliers.length === 0 ? (
                      <div className="text-[0.7rem] text-[#6272a4]">
                        No significant deviations detected.
                      </div>
                    ) : (
                      <ul className="space-y-2 text-[0.72rem] text-[#cdd6f4]">
                        {edgeStats.outliers.map((edge) => (
                          <li key={edge.id} className="rounded-md border border-[#2a3347] bg-[#141820] px-3 py-2">
                            <div className="font-semibold">
                              {edge.source} → {edge.target}
                            </div>
                            <div className="text-[0.68rem] text-[#6272a4]">{edge.label}</div>
                            <div className="text-[0.68rem] text-[#9aa6cf]">
                              Strength {edge.strength} (z={edge.z.toFixed(2)})
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl border border-[#2a3347] bg-[#0d0f14] p-4">
                    <div className="mb-2 text-[0.66rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                      Graph Summary
                    </div>
                    <div className="grid gap-1.5 text-[0.72rem] text-[#cdd6f4]">
                      <div>{nodesCount} nodes, {edgesCount} edges</div>
                      <div>{communities.length} communities detected</div>
                      <div>{legendTypes.length} entity types</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Map is now a fullscreen overlay — see showMap state */}

              {/* ─── OSINT Panel ─── */}
              {rightPanel === "osint" && (
                <div className="flex h-full flex-col">
                  <div className="border-b border-[#2a3347] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#6272a4]">
                        OSINT Enrichment
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleOsintRefresh()}
                        className="rounded border border-[#2a3347] px-2 py-0.5 text-[0.6rem] text-[#6272a4] transition hover:border-[#5b8dff] hover:text-[#5b8dff]"
                      >
                        Refresh
                      </button>
                    </div>
                    <p className="text-[0.62rem] leading-relaxed text-[#6272a4]">
                      Find entities that need more intelligence and dispatch human OSINT researchers via Terac.
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3">
                    {/* Analyze button */}
                    <button
                      type="button"
                      onClick={() => void handleOsintAnalyze()}
                      disabled={osintAnalyzing || Object.keys(nodeMetaMap).length === 0}
                      className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#4af0b0] bg-[#102018] py-2 text-[0.7rem] font-semibold text-[#4af0b0] transition hover:bg-[#143020] disabled:opacity-40"
                    >
                      {osintAnalyzing ? (
                        <>
                          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:0ms]" />
                          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:150ms]" />
                          <span className="inline-block size-1.5 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:300ms]" />
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                          Scan Graph for Thin Entities
                        </>
                      )}
                    </button>

                    {/* Candidates list */}
                    {osintCandidates.length > 0 && (
                      <div className="mb-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[0.6rem] uppercase tracking-[0.1em] text-[#6272a4]">
                            {osintCandidates.length} candidates found
                          </span>
                          <span className="text-[0.55rem] text-[#6272a4]">
                            {osintSelected.size} selected
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {osintCandidates.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                setOsintSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.name)) next.delete(c.name);
                                  else next.add(c.name);
                                  return next;
                                });
                              }}
                              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
                                osintSelected.has(c.name)
                                  ? "border-[#4af0b0] bg-[#102018]"
                                  : "border-[#2a3347] bg-[#0d0f14] hover:border-[#5b8dff]"
                              }`}
                            >
                              <div
                                className={`mt-1 size-3 shrink-0 rounded border-2 transition ${
                                  osintSelected.has(c.name)
                                    ? "border-[#4af0b0] bg-[#4af0b0]"
                                    : "border-[#6272a4]"
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[0.68rem] font-semibold text-[#cdd6f4]">
                                  {c.name}
                                </div>
                                <div className="flex items-center gap-2 text-[0.55rem] text-[#6272a4]">
                                  <span>{c.category}</span>
                                  <span>&middot;</span>
                                  <span>{c.edgeCount} edges</span>
                                  {c.centrality > 0 && (
                                    <>
                                      <span>&middot;</span>
                                      <span>cent: {c.centrality.toFixed(3)}</span>
                                    </>
                                  )}
                                </div>
                                {c.desc && (
                                  <div className="mt-0.5 truncate text-[0.58rem] text-[#9aa6cf]">
                                    {c.desc}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>

                        {/* Dispatch button */}
                        <button
                          type="button"
                          onClick={() => void handleOsintCreate()}
                          disabled={osintCreating || osintSelected.size === 0}
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#5b8dff] bg-[#0f1628] py-2 text-[0.7rem] font-semibold text-[#5b8dff] transition hover:bg-[#152040] disabled:opacity-40"
                        >
                          {osintCreating ? "Dispatching..." : `Dispatch ${osintSelected.size} to Terac`}
                        </button>
                      </div>
                    )}

                    {/* Active tasks */}
                    {osintTasks.length > 0 && (
                      <div>
                        <div className="mb-2 text-[0.6rem] uppercase tracking-[0.1em] text-[#6272a4]">
                          Tasks ({osintTasks.length})
                        </div>
                        <div className="space-y-2">
                          {osintTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-lg border border-[#2a3347] bg-[#0d0f14] p-3"
                            >
                              <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-[0.65rem] font-semibold text-[#cdd6f4]">
                                  {task.id.slice(-8)}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[0.5rem] font-bold uppercase tracking-[0.1em] ${
                                    task.status === "active"
                                      ? "bg-[#4af0b0]/15 text-[#4af0b0]"
                                      : task.status === "completed"
                                        ? "bg-[#5b8dff]/15 text-[#5b8dff]"
                                        : "bg-[#6272a4]/15 text-[#6272a4]"
                                  }`}
                                >
                                  {task.status}
                                </span>
                              </div>
                              <div className="mb-1 text-[0.58rem] text-[#6272a4]">
                                {task.entities.length} entities &middot;{" "}
                                {new Date(task.createdAt).toLocaleString()}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {task.entities.slice(0, 4).map((e) => (
                                  <span
                                    key={e.name}
                                    className="rounded-full border border-[#2a3347] bg-[#1c2230] px-2 py-0.5 text-[0.55rem] text-[#9aa6cf]"
                                  >
                                    {e.name}
                                  </span>
                                ))}
                                {task.entities.length > 4 && (
                                  <span className="text-[0.55rem] text-[#6272a4]">
                                    +{task.entities.length - 4} more
                                  </span>
                                )}
                              </div>
                              {task.dashboardUrl && (
                                <a
                                  href={task.dashboardUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-block text-[0.6rem] text-[#5b8dff] hover:text-[#7aa4ff]"
                                >
                                  Open Dashboard &rarr;
                                </a>
                              )}
                              {task.totalCost != null && task.totalCost > 0 && (
                                <div className="mt-1 text-[0.55rem] text-[#6272a4]">
                                  Cost: ${task.totalCost.toFixed(2)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {osintCandidates.length === 0 && osintTasks.length === 0 && !osintAnalyzing && (
                      <div className="py-6 text-center text-[0.68rem] text-[#6272a4]">
                        <p className="mb-2">No active OSINT tasks.</p>
                        <p className="text-[0.6rem]">
                          Click &quot;Scan Graph&quot; to identify entities that need human intelligence research.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Settings popover ─── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSettings(false)} />
          <div className="relative mt-12 mr-4 w-[340px] rounded-xl border border-[#2a3347] bg-[#141820] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
                Settings
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-[0.8rem] text-[#6272a4] hover:text-[#cdd6f4]"
              >
                x
              </button>
            </div>
            <label className="mb-3 flex items-center gap-2 rounded-lg border border-[#2a3347] bg-[#0d0f14] px-3 py-2.5 text-[0.72rem] text-[#cdd6f4]">
              <input
                type="checkbox"
                checked={rankingsEnabled}
                onChange={(event) => setRankingsEnabled(event.target.checked)}
                className="size-3.5 accent-[#4af0b0]"
              />
              Enable rankings
            </label>
            <div className="grid gap-2 text-[0.72rem] text-[#cdd6f4]">
              {[
                { key: "degree", label: "Degree", desc: "Direct activity level." },
                { key: "closeness", label: "Closeness", desc: "Strategic network access." },
                { key: "eigenvector", label: "Eigenvector", desc: "Influence via high-value connections." },
                { key: "betweenness", label: "Betweenness", desc: "Bridge/chokepoint detection." },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border border-[#2a3347] bg-[#0d0f14] px-3 py-2 ${
                    rankingsEnabled ? "" : "opacity-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="ranking-mode"
                    value={opt.key}
                    checked={rankingMode === opt.key}
                    onChange={() => setRankingMode(opt.key as CentralityKind)}
                    className="mt-0.5 size-3.5 accent-[#4af0b0]"
                    disabled={!rankingsEnabled}
                  />
                  <div>
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-[0.64rem] text-[#6272a4]">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            {rankingMode === "closeness" && (
              <div className="mt-3 rounded-lg border border-[#2a3347] bg-[#0d0f14] px-3 py-2">
                <div className="mb-1 text-[0.62rem] uppercase tracking-[0.12em] text-[#6272a4]">
                  Min Connections
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={minClosenessDegree}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setMinClosenessDegree(Number.isFinite(next) ? Math.max(0, next) : 0);
                    }}
                    className="w-16 rounded-md border border-[#2a3347] bg-[#0d0f14] px-2 py-1 text-[0.72rem] text-[#cdd6f4] outline-none focus:border-[#5b8dff]"
                    disabled={!rankingsEnabled}
                  />
                  <div className="text-[0.64rem] text-[#6272a4]">
                    Nodes with fewer get score 0.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Fullscreen Map Overlay ─── */}
      {showMap && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[#0d0f14]"
          onKeyDown={(e) => { if (e.key === "Escape") setShowMap(false); }}
        >
          <div className="flex items-center justify-between border-b border-[#2a3347] bg-[#141820] px-5 py-2.5">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4 text-[#4af0b0]">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
              <span className="text-[0.8rem] font-semibold tracking-wide text-[#cdd6f4]">Geographic View</span>
            </div>
            <button
              type="button"
              onClick={() => setShowMap(false)}
              className="grid size-8 place-items-center rounded-lg border border-[#2a3347] text-[#6272a4] transition hover:border-[#ff6b6b] hover:text-[#ff6b6b]"
              title="Close map"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <MapPanel nodeMetaMap={nodeMetaMap} edgeMetaMap={edgeMetaMap} isActive={showMap} />
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40">
        <Toast message={toastMessage} visible={toastVisible} />
      </div>
    </div>
  );
}
