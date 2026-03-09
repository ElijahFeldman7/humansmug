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
  const [physicsEnabled, setPhysicsEnabled] = useState(true);

  const renderNetwork = useCallback(
    (nodes: GraphNode[], edges: GraphEdge[], handlers: RenderHandlers): boolean => {
      if (!networkElementRef.current) {
        return false;
      }

      networkInstanceRef.current?.destroy();

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

      const shouldUsePhysics = nodes.length <= 160;
      const network = new Network(
        networkElementRef.current,
        data as never,
        buildOptions(shouldUsePhysics) as never,
      );
      networkInstanceRef.current = network;
      setPhysicsEnabled(shouldUsePhysics);

      if (shouldUsePhysics) {
        network.once("stabilized", () => {
          network.setOptions({ physics: { enabled: false } });
          setPhysicsEnabled(false);
        });
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
      networkInstanceRef.current?.destroy();
    };
  }, []);

  return {
    renderNetwork,
    fitGraph,
    focusNode,
    togglePhysics,
    physicsEnabled,
  };
};
