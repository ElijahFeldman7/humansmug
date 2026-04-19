import { getColor } from "./constants";
import type { ParsedGraphData } from "./types";

export const parseTuples = (rawText: string): ParsedGraphData => {
  const normalizeNodeName = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

  const isExcludedCategory = (raw: string) => {
    const normalized = (raw || "").trim().toUpperCase();
    return (
      !normalized ||
      normalized === "DEFAULT" ||
      normalized === "CASE" ||
      normalized === "COURT" ||
      normalized === "CONCEPT" ||
      normalized === "CONCEPTS" ||
      normalized === "UNKNOWN"
    );
  };

  const isExcludedName = (raw: string) => {
    const value = raw.trim();
    if (!value) return true;
    const upper = normalizeNodeName(value);

    if (
      upper.includes("US DISTRICT COURT") ||
      upper.includes("U.S. DISTRICT COURT") ||
      upper.includes("DISTRICT COURT") ||
      upper.includes("COURT OF APPEALS") ||
      upper.includes("SUPREME COURT")
    ) {
      return true;
    }

    // Case-style captions and legal citation patterns.
    if (/(\s|^)v\.(\s|$)/i.test(value) || /(\s|^)vs\.(\s|$)/i.test(value)) return true;
    if (/\bno\.\s*[0-9A-Z-]+\b/i.test(value)) return true;
    if (/\b\d{4}\s+WL\s+\d+\b/i.test(value)) return true;
    if (/\b\d+\s+F\.(?:\s?SUPP\.?\s?\d*|\dD|\dTH|APP'?X)\s+\d+\b/i.test(upper)) return true;

    return false;
  };

  const norm = rawText
    .replace(/""/g, '"')
    .replace(/\{tuple_delimiter\}/g, "\x01")
    .replace(/\{record_delimiter\}/g, "\n")
    .replace(/\{completion_delimiter\}/g, "");

  const nodes: ParsedGraphData["nodes"] = [];
  const edges: ParsedGraphData["edges"] = [];
  const nodeMetaMap: ParsedGraphData["nodeMetaMap"] = {};
  const edgeMetaMap: ParsedGraphData["edgeMetaMap"] = {};
  const incomingCount: Record<string, number> = {};
  const seenNodes = new Set<string>();
  const excludedNodeNames = new Set<string>();
  let edgeCounter = 0;

  const removeNodeAndIncidentEdges = (nodeId: string) => {
    delete nodeMetaMap[nodeId];
    seenNodes.delete(nodeId);
    delete incomingCount[nodeId];

    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].id === nodeId) {
        nodes.splice(i, 1);
      }
    }

    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const edge = edges[i];
      if (edge.from === nodeId || edge.to === nodeId) {
        if (edge.id) {
          delete edgeMetaMap[String(edge.id)];
        }
        edges.splice(i, 1);
      }
    }
  };

  // Support both placeholder delimiters and pipe-delimited tuples.
  const re = /\("([^"]+)"\s*(?:\x01|\|)\s*([\s\S]+?)\)(?=\s*(?:\n|$|\())/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(norm)) !== null) {
    const type = match[1].toLowerCase().trim();
    const rawContent = match[2];
    const tupleSeparator = rawContent.includes("\x01") ? "\x01" : "|";
    const parts = rawContent
      .split(tupleSeparator)
      .map((part) => part.trim())
      .map((part) => part.replace(/^"|"$/g, ""));

    if (type === "entity" && parts.length >= 2) {
      const [nameRaw, categoryRaw, ...descPartsRaw] = parts;
      const name = (nameRaw || "").trim();
      const category = (categoryRaw || "").trim();
      const descParts = descPartsRaw.map((part) => part.trim()).filter(Boolean);
      let desc = descParts.join(" ").trim();
      if (desc.endsWith(")")) {
        desc = desc.slice(0, -1).trim();
      }
      const normalizedCategory = (category || "").trim().toUpperCase();

      if (name && (isExcludedCategory(normalizedCategory) || isExcludedName(name))) {
        const excludedKey = normalizeNodeName(name);
        excludedNodeNames.add(excludedKey);
        if (seenNodes.has(name)) {
          removeNodeAndIncidentEdges(name);
        }
        continue;
      }

      // Split merged descriptions (joined with " || " by mergeTuplesLocally)
      const splitDescs = desc
        ? desc.split(" || ").map((d) => d.trim()).filter(Boolean)
        : [];

      if (name && !seenNodes.has(name)) {
        const c = getColor(normalizedCategory);
        const descs = [...splitDescs];
        nodeMetaMap[name] = { name, category: normalizedCategory, desc: descs[0] || "", descs };
        nodes.push({
          id: name,
          label: name,
          color: {
            background: c.bg,
            border: c.border,
            highlight: { background: c.bg, border: "#ffffff" },
            hover: { background: c.bg, border: c.accent },
          },
          font: { color: "#cdd6f4", size: 13, face: "JetBrains Mono, monospace" },
          shape: "ellipse",
          borderWidth: 2.5,
          borderWidthSelected: 3.5,
          widthConstraint: { minimum: 85, maximum: 135 },
          shadow: { enabled: true, color: `${c.border}44`, size: 14, x: 0, y: 0 },
        });
        seenNodes.add(name);
      } else if (name) {
        const meta = nodeMetaMap[name];
        if (meta) {
          // If this node was first created from a relationship fallback, upgrade it
          // to the explicit entity category when available.
          if (meta.category !== normalizedCategory) {
            meta.category = normalizedCategory;
            const c = getColor(normalizedCategory);
            const node = nodes.find((n) => n.id === name);
            if (node) {
              node.color = {
                background: c.bg,
                border: c.border,
                highlight: { background: c.bg, border: "#ffffff" },
                hover: { background: c.bg, border: c.accent },
              };
            }
          }

          const existing = meta.descs ? [...meta.descs] : meta.desc ? [meta.desc] : [];
          for (const d of splitDescs) {
            if (d && !existing.includes(d)) {
              existing.push(d);
            }
          }
          meta.descs = existing;
          if (!meta.desc && existing.length > 0) {
            meta.desc = existing[0];
          }
        }
      }
    }

    if (type === "relationship" && parts.length >= 3) {
      const [source, target, label, strengthRaw, ...evidenceParts] = parts;

      const sourceKey = normalizeNodeName(source);
      const targetKey = normalizeNodeName(target);
      if (
        excludedNodeNames.has(sourceKey) ||
        excludedNodeNames.has(targetKey) ||
        isExcludedName(source) ||
        isExcludedName(target)
      ) {
        continue;
      }

      const strength = Math.min(10, Math.max(1, Number.parseFloat(strengthRaw) || 5));
      const evidence = evidenceParts.join(" ").trim();

      [source, target].forEach((nodeId) => {
        if (!seenNodes.has(nodeId)) {
          const fallbackCategory = "ORGANIZATION";
          const c = getColor(fallbackCategory);
          nodeMetaMap[nodeId] = { name: nodeId, category: fallbackCategory, desc: "", descs: [] };
          nodes.push({
            id: nodeId,
            label: nodeId,
            color: {
              background: c.bg,
              border: c.border,
              highlight: { background: c.bg, border: "#ffffff" },
            },
            font: { color: "#cdd6f4", size: 13, face: "JetBrains Mono, monospace" },
            shape: "ellipse",
            borderWidth: 2.5,
            widthConstraint: { minimum: 85, maximum: 135 },
          });
          seenNodes.add(nodeId);
        }
      });

      const edgeWidth = 1 + ((strength - 1) / 9) * 7;
      const edgeId = `e${edgeCounter++}`;
      edgeMetaMap[edgeId] = { id: edgeId, source, target, label, strength, evidence: evidence || undefined };

      edges.push({
        id: edgeId,
        from: source,
        to: target,
        label,
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        font: {
          size: 10,
          color: "#6272a4",
          face: "JetBrains Mono, monospace",
          strokeWidth: 3,
          strokeColor: "#0d0f14",
          align: "middle",
        },
        color: { color: "#2a3347", highlight: "#4af0b0", hover: "#5b8dff" },
        width: edgeWidth,
        smooth: { type: "curvedCW", roundness: 0.15 },
      });
      incomingCount[target] = (incomingCount[target] || 0) + 1;
    }
  }

  const maxIncoming = Math.max(1, ...Object.values(incomingCount));
  const minSize = 18;
  const maxSize = 42;
  const minWidth = 78;
  const maxWidth = 150;
  const minHeight = 28;
  const maxHeight = 52;
  const SCALE_BOOST = 1.5;
  nodes.forEach((node) => {
    const incoming = incomingCount[node.id] || 0;
    const scaleRaw =
      maxIncoming <= 1 ? 0 : Math.log(incoming + 1) / Math.log(maxIncoming + 1);
    const scale = Math.min(1, scaleRaw * SCALE_BOOST);
    const size = minSize + (maxSize - minSize) * scale;
    const width = minWidth + (maxWidth - minWidth) * scale;
    const height = minHeight + (maxHeight - minHeight) * scale;
    node.size = size;
    node.value = incoming;
    node.widthConstraint = { minimum: Math.round(width), maximum: Math.round(width + 40) };
    node.heightConstraint = { minimum: Math.round(height), maximum: Math.round(height + 16) };
    if (node.font && typeof node.font === "object") {
      const font = node.font as { size?: number };
      font.size = 12 + Math.round(scale * 4);
    }
  });

  return { nodes, edges, nodeMetaMap, edgeMetaMap };
};
