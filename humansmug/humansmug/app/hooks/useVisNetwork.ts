"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { DataSet, Network } from "vis-network/standalone";
import type { GraphEdge, GraphNode } from "@/app/lib/graph/types";

type RenderHandlers = {
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearDetail: () => void;
};

const buildOptions = (physicsEnabled: boolean) => ({
  physics: {
    enabled: physicsEnabled,
    solver: "forceAtlas2Based",
    forceAtlas2Based: {
      gravitationalConstant: -90,
      centralGravity: 0.005,
      springLength: 200,
      springConstant: 0.05,
      damping: 0.6,
    },
    stabilization: { iterations: physicsEnabled ? 250 : 60, updateInterval: 10 },
  },
  interaction: { hover: true, tooltipDelay: 99999, zoomView: true, dragView: true },
  layout: { randomSeed: 7 },
});

export const useVisNetwork = (networkElementRef: RefObject<HTMLDivElement | null>) => {
  const networkInstanceRef = useRef<Network | null>(null);
  const physicsTimeoutRef = useRef<number | null>(null);
  const nodesDataRef = useRef<DataSet<GraphNode> | null>(null);
  const edgesDataRef = useRef<DataSet<GraphEdge> | null>(null);
  const nodeBaseRef = useRef<Map<string, { color: unknown; font: unknown; shadow?: unknown }>>(new Map());
  const edgeBaseRef = useRef<Map<string, { color: unknown; font: unknown }>>(new Map());
  const [physicsEnabled, setPhysicsEnabled] = useState(true);

  const toRgba = (color: string, alpha: number) => {
    const hex = color.replace("#", "");
    if (/^rgba?\(/.test(color)) return color;
    if (hex.length === 3 || hex.length === 6) {
      const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
      const r = Number.parseInt(full.slice(0, 2), 16);
      const g = Number.parseInt(full.slice(2, 4), 16);
      const b = Number.parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  };

  const applyAlphaToColor = (color: unknown, alpha: number) => {
    if (typeof color === "string") return toRgba(color, alpha);
    if (color && typeof color === "object") {
      const obj = color as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      Object.entries(obj).forEach(([key, value]) => {
        out[key] = typeof value === "string" ? toRgba(value, alpha) : value;
      });
      return out;
    }
    return color;
  };

  const renderNetwork = useCallback(
    (nodes: GraphNode[], edges: GraphEdge[], handlers: RenderHandlers): boolean => {
      if (!networkElementRef.current) {
        return false;
      }

      networkInstanceRef.current?.destroy();
      if (physicsTimeoutRef.current !== null) {
        window.clearTimeout(physicsTimeoutRef.current);
        physicsTimeoutRef.current = null;
      }

      const heavyGraph = nodes.length > 200;
      const tunedNodes = heavyGraph
        ? nodes.map((node) => ({
            ...node,
            font: { ...(node.font as Record<string, unknown>), size: 10 },
            shadow: { enabled: false },
          }))
        : nodes;
      const tunedEdges = heavyGraph
        ? edges.map((edge) => ({
            ...edge,
            label: "",
            font: { size: 0 },
            smooth: false,
          }))
        : edges;

      const data = {
        nodes: new DataSet(tunedNodes as never[]),
        edges: new DataSet(tunedEdges as never[]),
      };
      nodesDataRef.current = data.nodes as DataSet<GraphNode>;
      edgesDataRef.current = data.edges as DataSet<GraphEdge>;
      nodeBaseRef.current = new Map(
        tunedNodes.map((node) => [node.id, { color: node.color, font: node.font, shadow: node.shadow }]),
      );
      edgeBaseRef.current = new Map(
        tunedEdges.map((edge) => [edge.id, { color: edge.color, font: edge.font }]),
      );

      const shouldUsePhysics = nodes.length <= 300;
      const shouldPulsePhysics = !shouldUsePhysics && nodes.length <= 600;
      const physicsMode = shouldUsePhysics || shouldPulsePhysics;
      const network = new Network(
        networkElementRef.current,
        data as never,
        buildOptions(physicsMode) as never,
      );
      networkInstanceRef.current = network;
      setPhysicsEnabled(physicsMode);

      if (physicsMode) {
        let finalized = false;
        const finalize = () => {
          if (finalized) return;
          finalized = true;
          if (physicsTimeoutRef.current !== null) {
            window.clearTimeout(physicsTimeoutRef.current);
            physicsTimeoutRef.current = null;
          }
          network.setOptions({ physics: { enabled: false } });
          setPhysicsEnabled(false);
          network.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
        };
        network.once("stabilized", finalize);
        physicsTimeoutRef.current = window.setTimeout(finalize, shouldUsePhysics ? 1400 : 900);
      }

      network.on("selectNode", (payload) => {
        if (payload.nodes.length) {
          handlers.onSelectNode(payload.nodes[0]);
        }
      });

      network.on("selectEdge", (payload) => {
        if (payload.edges.length && !payload.nodes.length) {
          handlers.onSelectEdge(payload.edges[0]);
        }
      });

      network.on("deselectNode", handlers.onClearDetail);
      network.on("deselectEdge", handlers.onClearDetail);

      return true;
    },
    [networkElementRef],
  );

  const setHighlight = useCallback((highlightIds: Set<string> | null) => {
    if (!nodesDataRef.current || !edgesDataRef.current) return;
    const dimAlpha = 0.18;
    const fontDim = "#6272a480";
    const nodes = nodesDataRef.current.get();
    const edges = edgesDataRef.current.get();

    const nodeUpdates = nodes.map((node) => {
      const base = nodeBaseRef.current.get(node.id);
      if (!highlightIds || highlightIds.has(node.id)) {
        return { id: node.id, color: base?.color ?? node.color, font: base?.font ?? node.font, shadow: base?.shadow ?? node.shadow };
      }
      return {
        id: node.id,
        color: applyAlphaToColor(base?.color ?? node.color, dimAlpha),
        font: { ...(base?.font as Record<string, unknown>), color: fontDim },
        shadow: { enabled: false },
      };
    });

    const edgeUpdates = edges.map((edge) => {
      const base = edgeBaseRef.current.get(edge.id);
      if (!highlightIds) {
        return { id: edge.id, color: base?.color ?? edge.color, font: base?.font ?? edge.font };
      }
      const from = String(edge.from);
      const to = String(edge.to);
      const keep = highlightIds.has(from) && highlightIds.has(to);
      if (keep) {
        return { id: edge.id, color: base?.color ?? edge.color, font: base?.font ?? edge.font };
      }
      return {
        id: edge.id,
        color: applyAlphaToColor(base?.color ?? edge.color, dimAlpha),
        font: { ...(base?.font as Record<string, unknown>), color: fontDim },
      };
    });

    nodesDataRef.current.update(nodeUpdates as never[]);
    edgesDataRef.current.update(edgeUpdates as never[]);
  }, []);

  const fitGraph = useCallback(() => {
    networkInstanceRef.current?.fit({
      animation: { duration: 500, easingFunction: "easeInOutQuad" },
    });
  }, []);

  const focusNode = useCallback((id: string) => {
    if (!networkInstanceRef.current) {
      return;
    }

    networkInstanceRef.current.selectNodes([id]);
    networkInstanceRef.current.focus(id, {
      scale: 1.4,
      animation: { duration: 600, easingFunction: "easeInOutQuad" },
    });
  }, []);

  const togglePhysics = useCallback((): boolean | null => {
    if (!networkInstanceRef.current) {
      return null;
    }

    let nextState = false;
    setPhysicsEnabled((previous) => {
      nextState = !previous;
      networkInstanceRef.current?.setOptions({ physics: { enabled: nextState } });
      return nextState;
    });

    return nextState;
  }, []);

  useEffect(() => {
    return () => {
      if (physicsTimeoutRef.current !== null) {
        window.clearTimeout(physicsTimeoutRef.current);
        physicsTimeoutRef.current = null;
      }
      networkInstanceRef.current?.destroy();
    };
  }, []);

  return {
    renderNetwork,
    fitGraph,
    focusNode,
    togglePhysics,
    physicsEnabled,
    setHighlight,
  };
};
