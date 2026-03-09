export type ColorDef = { bg: string; border: string; accent: string };

export type NodeMeta = {
  name: string;
  category: string;
  desc: string;
};

export type EdgeMeta = {
  id: string;
  source: string;
  target: string;
  label: string;
  strength: number;
};

export type NodeDetail = { kind: "node"; data: NodeMeta };
export type EdgeDetail = { kind: "edge"; data: EdgeMeta };
export type DetailState = NodeDetail | EdgeDetail | null;

export type GraphNode = {
  id: string;
  label: string;
  color: unknown;
  font: unknown;
  shape: string;
  borderWidth: number;
  borderWidthSelected?: number;
  widthConstraint: { minimum: number; maximum: number };
  shadow?: unknown;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  arrows: unknown;
  font: unknown;
  color: unknown;
  width: number;
  smooth: unknown;
};

export type ParsedGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMetaMap: Record<string, NodeMeta>;
  edgeMetaMap: Record<string, EdgeMeta>;
};
