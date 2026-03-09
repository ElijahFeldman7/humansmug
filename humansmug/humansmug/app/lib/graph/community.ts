import type { EdgeMeta } from "./types";

export type CommunityResult = {
  communities: Array<{ id: number; nodes: string[]; size: number }>;
  nodeToCommunity: Record<string, number>;
};

type WeightedAdj = Map<number, number>;

type Graph = {
  adj: WeightedAdj[];
  degrees: number[];
  m2: number;
};

function buildGraph(nodeIds: string[], edges: EdgeMeta[]): Graph {
  const indexById = new Map<string, number>();
  nodeIds.forEach((id, idx) => indexById.set(id, idx));
  const n = nodeIds.length;
  const adj: WeightedAdj[] = Array.from({ length: n }, () => new Map());
  const degrees = new Array(n).fill(0);

  edges.forEach((edge) => {
    const from = indexById.get(edge.source);
    const to = indexById.get(edge.target);
    if (from === undefined || to === undefined || from === to) return;
    const weight = Number.isFinite(edge.strength) ? edge.strength : 1;
    const prevAB = adj[from].get(to) || 0;
    const prevBA = adj[to].get(from) || 0;
    adj[from].set(to, prevAB + weight);
    adj[to].set(from, prevBA + weight);
  });

  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    adj[i].forEach((w) => {
      sum += w;
    });
    degrees[i] = sum;
  }

  const m2 = degrees.reduce((acc, v) => acc + v, 0);
  return { adj, degrees, m2 };
}

function oneLevel(graph: Graph, maxPasses = 20): number[] {
  const { adj, degrees, m2 } = graph;
  const n = adj.length;
  const community = Array.from({ length: n }, (_, i) => i);
  const sumTot = degrees.slice();
  const sumIn = new Array(n).fill(0);

  let moved = true;
  let pass = 0;
  while (moved && pass < maxPasses) {
    moved = false;
    pass += 1;
    for (let i = 0; i < n; i += 1) {
      const ci = community[i];
      const k_i = degrees[i];
      if (k_i === 0) continue;

      const commWeights = new Map<number, number>();
      adj[i].forEach((w, j) => {
        const cj = community[j];
        commWeights.set(cj, (commWeights.get(cj) || 0) + w);
      });

      const k_i_in = commWeights.get(ci) || 0;

      sumTot[ci] -= k_i;
      sumIn[ci] -= k_i_in;
      community[i] = -1;

      let bestComm = ci;
      let bestGain = 0;
      commWeights.forEach((weight, c) => {
        const gain = weight - (sumTot[c] * k_i) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = c;
        }
      });

      community[i] = bestComm;
      sumTot[bestComm] += k_i;
      sumIn[bestComm] += commWeights.get(bestComm) || 0;

      if (bestComm !== ci) moved = true;
    }
  }

  return community;
}

function renumber(community: number[]): { renumbered: number[]; size: number } {
  const map = new Map<number, number>();
  let next = 0;
  const renumbered = community.map((c) => {
    if (!map.has(c)) {
      map.set(c, next++);
    }
    return map.get(c) as number;
  });
  return { renumbered, size: next };
}

function aggregateGraph(graph: Graph, community: number[], newSize: number): Graph {
  const { adj } = graph;
  const newAdj: WeightedAdj[] = Array.from({ length: newSize }, () => new Map());
  for (let i = 0; i < adj.length; i += 1) {
    const ci = community[i];
    adj[i].forEach((w, j) => {
      const cj = community[j];
      const prev = newAdj[ci].get(cj) || 0;
      newAdj[ci].set(cj, prev + w);
    });
  }
  const degrees = new Array(newSize).fill(0);
  for (let i = 0; i < newSize; i += 1) {
    let sum = 0;
    newAdj[i].forEach((w) => {
      sum += w;
    });
    degrees[i] = sum;
  }
  const m2 = degrees.reduce((acc, v) => acc + v, 0);
  return { adj: newAdj, degrees, m2 };
}

export function computeCommunities(
  nodeIds: string[],
  edges: EdgeMeta[],
  options?: { maxLevels?: number; maxPasses?: number },
): CommunityResult {
  const maxLevels = Math.max(1, options?.maxLevels ?? 6);
  const maxPasses = Math.max(5, options?.maxPasses ?? 20);

  if (nodeIds.length === 0) {
    return { communities: [], nodeToCommunity: {} };
  }

  let graph = buildGraph(nodeIds, edges);
  let currentCommunities = Array.from({ length: nodeIds.length }, (_, i) => i);
  let mapping = currentCommunities.slice();

  for (let level = 0; level < maxLevels; level += 1) {
    const levelCommunities = oneLevel(graph, maxPasses);
    const { renumbered, size } = renumber(levelCommunities);

    // update mapping from original nodes
    mapping = mapping.map((c) => renumbered[c]);

    if (size === graph.adj.length) {
      break;
    }

    graph = aggregateGraph(graph, renumbered, size);
    currentCommunities = Array.from({ length: size }, (_, i) => i);
  }

  const communitiesMap = new Map<number, string[]>();
  mapping.forEach((c, idx) => {
    if (!communitiesMap.has(c)) {
      communitiesMap.set(c, []);
    }
    communitiesMap.get(c)?.push(nodeIds[idx]);
  });

  const communities = Array.from(communitiesMap.entries())
    .map(([id, nodes]) => ({ id, nodes, size: nodes.length }))
    .sort((a, b) => b.size - a.size);

  const nodeToCommunity: Record<string, number> = {};
  mapping.forEach((c, idx) => {
    nodeToCommunity[nodeIds[idx]] = c;
  });

  return { communities, nodeToCommunity };
}
