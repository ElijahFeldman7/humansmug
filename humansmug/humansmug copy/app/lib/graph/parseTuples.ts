import { getColor } from "./constants";
import type { ParsedGraphData } from "./types";

export const parseTuples = (rawText: string): ParsedGraphData => {
  const norm = rawText
    .replace(/""/g, '"')
    .replace(/\{tuple_delimiter\}/g, "\x01")
    .replace(/\{record_delimiter\}/g, "\n")
    .replace(/\{completion_delimiter\}/g, "");

  const nodes: ParsedGraphData["nodes"] = [];
  const edges: ParsedGraphData["edges"] = [];
  const nodeMetaMap: ParsedGraphData["nodeMetaMap"] = {};
  const edgeMetaMap: ParsedGraphData["edgeMetaMap"] = {};
  const seenNodes = new Set<string>();
  let edgeCounter = 0;

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
      .map((part) => part.replace(/^"|"$/g, ""))
      .filter(Boolean);

    if (type === "entity" && parts.length >= 2) {
      const [name, category, ...descParts] = parts;
      const desc = descParts.join(" ");
      const normalizedCategory = (category || "DEFAULT").toUpperCase();

      if (!seenNodes.has(name)) {
        const c = getColor(normalizedCategory);
        nodeMetaMap[name] = { name, category: normalizedCategory, desc };
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
      }
    }

    if (type === "relationship" && parts.length >= 3) {
      const [source, target, label, strengthRaw] = parts;
      const strength = Math.min(10, Math.max(1, Number.parseFloat(strengthRaw) || 5));

      [source, target].forEach((nodeId) => {
        if (!seenNodes.has(nodeId)) {
          const c = getColor("DEFAULT");
          nodeMetaMap[nodeId] = { name: nodeId, category: "DEFAULT", desc: "" };
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
      edgeMetaMap[edgeId] = { id: edgeId, source, target, label, strength };

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
    }
  }

  return { nodes, edges, nodeMetaMap, edgeMetaMap };
};
