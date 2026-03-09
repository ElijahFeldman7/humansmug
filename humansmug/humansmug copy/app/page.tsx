"use client";

import { JetBrains_Mono, Syne } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailPanel } from "@/app/components/graph/DetailPanel";
import { EntityList } from "@/app/components/graph/EntityList";
import { GraphCanvas } from "@/app/components/graph/GraphCanvas";
import { HeaderStats } from "@/app/components/graph/HeaderStats";
import { Legend } from "@/app/components/graph/Legend";
import dynamic from "next/dynamic";
import { SidebarInput } from "@/app/components/graph/SidebarInput";
import { Toast } from "@/app/components/graph/Toast";
import { useVisNetwork } from "@/app/hooks/useVisNetwork";
import { parseTuples } from "@/app/lib/graph/parseTuples";
import { sampleTuples } from "@/app/lib/graph/sampleTuples";
import type { DetailState, EdgeMeta, NodeMeta } from "@/app/lib/graph/types";

type OllamaTupleResponse = {
  output?: string;
  model?: string;
  error?: string;
};

type TabKey = "diagram" | "input" | "entities" | "map" | "analysis";

const MapPanel = dynamic(() => import("@/app/components/graph/MapPanel"), { ssr: false });

const DEFAULT_SOURCE_TEXT =
  "Sai Deshpande coordinated migrant transport through cartel-linked routes near the US-Mexico border, using an 18-wheeler and support from local facilitators.";

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
  const toastTimerRef = useRef<number | null>(null);

  const { renderNetwork, fitGraph, focusNode, togglePhysics } = useVisNetwork(networkElementRef);

  const [sourceText, setSourceText] = useState(DEFAULT_SOURCE_TEXT);
  const [tupleInput, setTupleInput] = useState("");
  const [docFiles, setDocFiles] = useState<FileList | null>(null);
  const [isProcessingDocs, setIsProcessingDocs] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [nodeMetaMap, setNodeMetaMap] = useState<Record<string, NodeMeta>>({});
  const [edgeMetaMap, setEdgeMetaMap] = useState<Record<string, EdgeMeta>>({});
  const [llamaOutput, setLlamaOutput] = useState("");
  const [showLlamaOutput, setShowLlamaOutput] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [nodesCount, setNodesCount] = useState(0);
  const [edgesCount, setEdgesCount] = useState(0);
  const [legendTypes, setLegendTypes] = useState<string[]>([]);
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<DetailState>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [hasGraph, setHasGraph] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("diagram");
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const renderGraph = useCallback(
    (rawInput: string) => {
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
      if (nodes.length === 0) {
        showToast("No entities found - model output format may be invalid");
        return;
      }

      nodeMetaMapRef.current = nodeMetaMap;
      edgeMetaMapRef.current = edgeMetaMap;
      setNodeMetaMap(nodeMetaMap);
      setEdgeMetaMap(edgeMetaMap);

      const networkReady = renderNetwork(nodes, edges, {
        onSelectNode: (id) => {
          const meta = nodeMetaMapRef.current[id];
          if (meta) {
            setDetail({ kind: "node", data: meta });
          }
        },
        onSelectEdge: (id) => {
          const meta = edgeMetaMapRef.current[id];
          if (meta) {
            setDetail({ kind: "edge", data: meta });
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
      setDetail(null);
    },
    [renderNetwork, showToast],
  );

  const renderOnDiagram = useCallback(
    (rawInput: string) => {
      setActiveTab("diagram");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => renderGraph(rawInput));
      });
    },
    [renderGraph],
  );

  const handleGenerate = useCallback(() => {
    const run = async () => {
      const text = sourceText.trim();
      if (!text) {
        showToast("Paste plain text first");
        return;
      }

      setIsGenerating(true);
      try {
        const response = await fetch("/api/ollama-tuples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        const payload = (await response.json()) as OllamaTupleResponse;
        if (!response.ok || !payload.output) {
          showToast(payload.error || "Failed to get tuples from Ollama");
          return;
        }

        setLlamaOutput(payload.output);
        renderOnDiagram(payload.output);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        showToast(`Ollama request failed: ${message}`);
      } finally {
        setIsGenerating(false);
      }
    };

    void run();
  }, [renderOnDiagram, showToast, sourceText]);

  const handleRenderSample = useCallback(() => {
    setLlamaOutput(sampleTuples);
    setShowLlamaOutput(true);
    renderOnDiagram(sampleTuples);
  }, [renderOnDiagram]);

  const handleRenderTupleInput = useCallback(() => {
    const raw = tupleInput.trim();
    if (!raw) {
      showToast("Paste tuple output first");
      return;
    }
    setLlamaOutput(raw);
    setShowLlamaOutput(true);
    renderOnDiagram(raw);
  }, [renderOnDiagram, showToast, tupleInput]);

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
        blurbsCsvPath?: string;
        tuplesCsvPath?: string;
        mergedTuplesPath?: string;
        blurbCount?: number;
        error?: string;
      };

      if (!response.ok || !payload.mergedTuples) {
        throw new Error(payload.error || "Failed to process documents");
      }
      setProcessStatus(
        `Processed ${payload.blurbCount || 0} blurbs. Output saved to ${payload.tuplesCsvPath || ""} ${
          payload.mergedTuplesPath ? `(${payload.mergedTuplesPath})` : ""
        }`,
      );
      setTupleInput(payload.mergedTuples);
      setLlamaOutput(payload.mergedTuples);
      setShowLlamaOutput(true);
      renderOnDiagram(payload.mergedTuples);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setProcessStatus(`Failed: ${message}`);
      showToast(`Processing failed: ${message}`);
    } finally {
      setIsProcessingDocs(false);
    }
  }, [docFiles, renderOnDiagram, showToast]);

  const handleLoadFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        setSourceText(text);
        showToast(`Loaded ${file.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        showToast(`Failed to read file: ${message}`);
      }
    },
    [showToast],
  );

  const handleFocusNode = useCallback(
    (id: string) => {
      focusNode(id);
      const meta = nodeMetaMapRef.current[id];
      if (meta) {
        setDetail({ kind: "node", data: meta });
      }
    },
    [focusNode],
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

  useEffect(() => {
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
  }, []);

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

  return (
    <div
      className={`h-dvh overflow-hidden bg-[#0d0f14] text-[#cdd6f4] [font-family:var(--font-jetbrains)] ${jetBrainsMono.variable} ${syne.variable}`}
    >
      <div className="grid h-dvh grid-rows-[auto_auto_minmax(0,1fr)]">
        <div>
          <HeaderStats nodesCount={nodesCount} edgesCount={edgesCount} />
        </div>

        <div className="border-b border-[#2a3347] bg-[#0d0f14] px-4 py-2.5">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "diagram", label: "Diagram" },
              { key: "input", label: "Input" },
              { key: "entities", label: "Entities" },
              { key: "map", label: "Map" },
              { key: "analysis", label: "Analysis" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`rounded-full border px-4 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] transition ${
                  activeTab === tab.key
                    ? "border-[#4af0b0] bg-[#102018] text-[#4af0b0]"
                    : "border-[#2a3347] text-[#6272a4] hover:border-[#5b8dff] hover:text-[#cdd6f4]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "diagram" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr] md:grid-cols-[320px_1fr] md:grid-rows-[1fr]">
            <aside className="flex h-full max-h-[48dvh] flex-col overflow-hidden border-r border-[#2a3347] bg-[#141820] md:max-h-none">
              <DetailPanel detail={detail} />

              <div className="border-b border-[#2a3347] px-4 py-3.5">
                <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                  Node Types
                </div>
                <Legend types={legendTypes} />
              </div>

              <div className="px-4 pb-1 pt-2.5">
                <div className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                  Entities
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                <EntityList
                  entityIds={entityIds}
                  nodeMetaMap={nodeMetaMap}
                  onFocusNode={handleFocusNode}
                />
              </div>
            </aside>

            <div className="relative min-h-[360px] md:h-full md:min-h-0">
              <GraphCanvas
                hasGraph={hasGraph}
                networkRef={handleNetworkMount}
                onFitGraph={fitGraph}
                onTogglePhysics={handleTogglePhysics}
              />
            </div>
          </div>
        ) : null}

        {activeTab === "input" ? (
          <div className="grid min-h-0 place-items-start overflow-auto px-4 py-6 md:px-10">
            <div className="w-full max-w-2xl rounded-xl border border-[#2a3347] bg-[#141820] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
              <SidebarInput
                value={sourceText}
                onChange={setSourceText}
                onGenerate={handleGenerate}
                onRenderSample={handleRenderSample}
                onLoadFile={handleLoadFile}
                isLoading={isGenerating}
              />
              <div className="border-t border-[#2a3347] px-4 py-3">
                <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                  Settings
                </div>
                <label className="flex items-center gap-2 text-[0.72rem] text-[#cdd6f4]">
                  <input
                    type="checkbox"
                    checked={showLlamaOutput}
                    onChange={(event) => setShowLlamaOutput(event.target.checked)}
                    className="size-3.5 accent-[#4af0b0]"
                  />
                  Show tuple output
                </label>
              </div>
              {showLlamaOutput ? (
                <div className="border-t border-[#2a3347] px-4 py-3">
                  <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                    Tuple Output
                  </div>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-[#2a3347] bg-[#0d0f14] p-2.5 text-[0.63rem] leading-[1.45] text-[#cdd6f4]">
                    {llamaOutput || "No generated output yet."}
                  </pre>
                </div>
              ) : null}
            </div>
            <div className="mt-6 w-full max-w-2xl rounded-xl border border-[#2a3347] bg-[#141820] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
              <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                Tuple Input
              </div>
              <textarea
                value={tupleInput}
                onChange={(event) => setTupleInput(event.target.value)}
                placeholder='Paste tuple output here, e.g. ("entity"{tuple_delimiter}...'
                className="h-[170px] w-full resize-y rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2.5 text-[0.67rem] leading-[1.5] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/70 focus:border-[#5b8dff]"
              />
              <button
                type="button"
                onClick={handleRenderTupleInput}
                className="mt-2.5 w-full rounded-md border border-[#2a3347] bg-[#0d0f14] py-2 text-[0.74rem] font-semibold tracking-[0.06em] text-[#cdd6f4] transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
              >
                Render Tuple Input
              </button>
            </div>
            <div className="mt-6 w-full max-w-2xl rounded-xl border border-[#2a3347] bg-[#141820] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
              <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                Upload Documents (DOCX or CSV)
              </div>
              <input
                type="file"
                accept=".docx,.csv"
                multiple
                onChange={(event) => setDocFiles(event.target.files)}
                className="block w-full cursor-pointer rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2 text-[0.7rem] text-[#cdd6f4] file:mr-3 file:rounded file:border-0 file:bg-[#1c2230] file:px-3 file:py-1 file:text-[0.7rem] file:text-[#cdd6f4]"
              />
              <button
                type="button"
                onClick={handleProcessDocs}
                disabled={isProcessingDocs}
                className="mt-2.5 w-full rounded-md bg-[#4af0b0] py-2 text-[0.74rem] font-bold tracking-[0.06em] text-[#0d0f14] transition hover:bg-[#6ff5be] disabled:cursor-not-allowed disabled:bg-[#2f6f58]"
              >
                {isProcessingDocs ? "Processing..." : "Process Documents"}
              </button>
              {processStatus ? (
                <div className="mt-2 text-[0.68rem] text-[#6272a4]">{processStatus}</div>
              ) : null}
              <div className="mt-2 text-[0.64rem] text-[#6272a4]">
                Accepts DOCX, blurb CSVs, or already-parsed tuple CSVs (with `ner_re_output`).
              </div>
            </div>
            <div className="mt-3 text-[0.7rem] text-[#6272a4]">
              Tip: Use “Render Sample” to visualize tuples without a local model.
            </div>
          </div>
        ) : null}

        {activeTab === "entities" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr] md:grid-cols-[320px_1fr] md:grid-rows-[1fr]">
            <aside className="flex max-h-[48dvh] flex-col overflow-hidden border-r border-[#2a3347] bg-[#141820] md:max-h-none">
              <div className="px-4 pb-1 pt-3">
                <div className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
                  Entities
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                <EntityList
                  entityIds={entityIds}
                  nodeMetaMap={nodeMetaMap}
                  onFocusNode={handleFocusNode}
                />
              </div>
            </aside>
            <div className="flex h-full flex-col gap-4 overflow-auto p-6">
              <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-4">
                <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
                  Entity Details
                </div>
                <DetailPanel detail={detail} forceOpen emptyLabel="Select an entity to view details." />
              </div>
              <div className="rounded-xl border border-[#2a3347] bg-[#0d0f14] p-4 text-[0.72rem] text-[#6272a4]">
                Select an entity to view its description and type. Relationships are visible in the Diagram tab.
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "map" ? (
          <div className="h-full overflow-auto px-4 py-6 md:px-10">
            <MapPanel nodeMetaMap={nodeMetaMap} edgeMetaMap={edgeMetaMap} isActive />
          </div>
        ) : null}

        {activeTab === "analysis" ? (
          <div className="grid h-full gap-4 overflow-auto px-4 py-6 md:grid-cols-[1fr_1fr] md:px-10">
            <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-5">
              <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
                Relationship Strength Summary
              </div>
              <div className="grid gap-2 text-[0.75rem] text-[#cdd6f4]">
                <div>Mean strength: {edgeStats.mean.toFixed(2)}</div>
                <div>Std dev: {edgeStats.std.toFixed(2)}</div>
                <div>Outlier threshold: ≥ {edgeStats.threshold.toFixed(2)}</div>
              </div>
              <div className="mt-3 text-[0.68rem] text-[#6272a4]">
                Outliers flag relationships whose strengths significantly exceed the typical document signal.
              </div>
            </div>
            <div className="rounded-xl border border-[#2a3347] bg-[#141820] p-5">
              <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[#6272a4]">
                High-Deviation Relationships
              </div>
              {edgeStats.outliers.length === 0 ? (
                <div className="text-[0.7rem] text-[#6272a4]">
                  No significant deviations yet. Generate or render a graph first.
                </div>
              ) : (
                <ul className="space-y-2 text-[0.72rem] text-[#cdd6f4]">
                  {edgeStats.outliers.map((edge) => (
                    <li key={edge.id} className="rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2">
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
          </div>
        ) : null}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40">
        <Toast message={toastMessage} visible={toastVisible} />
      </div>
    </div>
  );
}
