import type { EdgeMeta } from "./types";

export type CentralityKind = "degree" | "closeness" | "eigenvector" | "betweenness";

type GraphIndex = {
  nodeIds: string[];
  indexById: Map<string, number>;
  outNeighbors: number[][];
  inNeighbors: number[][];
  undirectedNeighbors: number[][];
};

function buildIndex(nodeIds: string[], edges: EdgeMeta[]): GraphIndex {
  const indexById = new Map<string, number>();
  nodeIds.forEach((id, idx) => indexById.set(id, idx));
  const outNeighbors: number[][] = nodeIds.map(() => []);
  const inNeighbors: number[][] = nodeIds.map(() => []);
  const undirectedNeighbors: number[][] = nodeIds.map(() => []);

  edges.forEach((edge) => {
    const from = indexById.get(edge.source);
    const to = indexById.get(edge.target);
    if (from === undefined || to === undefined) return;
    outNeighbors[from].push(to);
    inNeighbors[to].push(from);
    undirectedNeighbors[from].push(to);
    undirectedNeighbors[to].push(from);
  });

  return { nodeIds, indexById, outNeighbors, inNeighbors, undirectedNeighbors };
}

export function computeCentrality(
  nodeIds: string[],
  edges: EdgeMeta[],
  kind: CentralityKind,
  options?: { minDegree?: number },
): Record<string, number> {
  const { outNeighbors, inNeighbors, undirectedNeighbors } = buildIndex(nodeIds, edges);
  const n = nodeIds.length;
  const scores: number[] = new Array(n).fill(0);
  const minDegree = Math.max(0, options?.minDegree ?? 0);

  if (n <= 1) {
    return Object.fromEntries(nodeIds.map((id) => [id, 0]));
  }

  if (kind === "degree") {
    for (let i = 0; i < n; i += 1) {
      const degree = outNeighbors[i].length;
      scores[i] = degree / (n - 1);
    }
  }

  if (kind === "closeness") {
    // Find connected components so we can exclude tiny isolated clusters
    const componentId = new Array(n).fill(-1);
    const componentSize = new Array(n).fill(0);
    let compIdx = 0;
    for (let i = 0; i < n; i += 1) {
      if (componentId[i] !== -1) continue;
      const queue: number[] = [i];
      let head = 0;
      componentId[i] = compIdx;
      while (head < queue.length) {
        const v = queue[head++];
        for (const w of undirectedNeighbors[v]) {
          if (componentId[w] === -1) {
            componentId[w] = compIdx;
            queue.push(w);
          }
        }
      }
      const size = queue.length;
      for (const v of queue) componentSize[v] = size;
      compIdx += 1;
    }

    // Find the largest component size
    const maxCompSize = Math.max(...componentSize);
    // Minimum component size to include (at least 3, or 10% of largest)
    const minCompSize = Math.max(3, Math.floor(maxCompSize * 0.1));

    for (let i = 0; i < n; i += 1) {
      if (undirectedNeighbors[i].length < minDegree || componentSize[i] < minCompSize) {
        scores[i] = 0;
        continue;
      }
      const dist = new Array(n).fill(-1);
      dist[i] = 0;
      const queue: number[] = [i];
      let head = 0;
      while (head < queue.length) {
        const v = queue[head++];
        for (const w of undirectedNeighbors[v]) {
          if (dist[w] === -1) {
            dist[w] = dist[v] + 1;
            queue.push(w);
          }
        }
      }
      // Only count reachable nodes
      let sum = 0;
      let reachable = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i && dist[j] >= 0) continue;
        if (dist[j] > 0) {
          sum += dist[j];
          reachable += 1;
        }
      }
      scores[i] = sum > 0 && reachable > 0 ? reachable / sum : 0;
    }
  }

  if (kind === "eigenvector") {
    const x = new Array(n).fill(1 / n);
    const maxIter = 120;
    const epsilon = 1e-6;
    for (let iter = 0; iter < maxIter; iter += 1) {
      const next = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        let sum = 0;
        for (const j of inNeighbors[i]) {
          sum += x[j];
        }
        next[i] = sum;
      }
      const norm = Math.hypot(...next);
      if (norm === 0) break;
      for (let i = 0; i < n; i += 1) {
        next[i] /= norm;
      }
      let delta = 0;
      for (let i = 0; i < n; i += 1) {
        delta += Math.abs(next[i] - x[i]);
        x[i] = next[i];
      }
      if (delta < epsilon) break;
    }
    for (let i = 0; i < n; i += 1) {
      scores[i] = x[i];
    }
  }

  if (kind === "betweenness") {
    const cb = new Array(n).fill(0);
    for (let s = 0; s < n; s += 1) {
      const stack: number[] = [];
      const predecessors: number[][] = new Array(n).fill(0).map(() => []);
      const sigma = new Array(n).fill(0);
      sigma[s] = 1;
      const dist = new Array(n).fill(-1);
      dist[s] = 0;
      const queue: number[] = [s];
      let head = 0;
      while (head < queue.length) {
        const v = queue[head++];
        stack.push(v);
        for (const w of outNeighbors[v]) {
          if (dist[w] < 0) {
            dist[w] = dist[v] + 1;
            queue.push(w);
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            predecessors[w].push(v);
          }
        }
      }
      const delta = new Array(n).fill(0);
      while (stack.length) {
        const w = stack.pop() as number;
        for (const v of predecessors[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== s) cb[w] += delta[w];
      }
    }
    for (let i = 0; i < n; i += 1) {
      scores[i] = cb[i];
    }
  }

  return Object.fromEntries(nodeIds.map((id, idx) => [id, scores[idx] || 0]));
}
