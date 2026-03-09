import { useState, useMemo } from "react";
import { getColor } from "@/app/lib/graph/constants";
import type { NodeMeta } from "@/app/lib/graph/types";

type EntityListProps = {
  entityIds: string[];
  nodeMetaMap: Record<string, NodeMeta>;
  onFocusNode: (id: string) => void;
};

export function EntityList({ entityIds, nodeMetaMap, onFocusNode }: EntityListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entityIds;
    return entityIds.filter((id) => {
      const meta = nodeMetaMap[id];
      return (
        id.toLowerCase().includes(q) ||
        meta?.name?.toLowerCase().includes(q) ||
        meta?.category?.toLowerCase().includes(q)
      );
    });
  }, [entityIds, nodeMetaMap, query]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-3 py-2 pr-4">
      <div className="relative mb-2 shrink-0">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-[#6272a4]"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entities..."
          className="w-full rounded-lg border border-[#2a3347] bg-[#0d0f14] py-1.5 pl-8 pr-3 text-[0.68rem] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/60 focus:border-[#5b8dff]"
        />
      </div>
      <div className="mb-1.5 shrink-0 text-[0.55rem] text-[#6272a4]">
        {filtered.length}{query ? ` / ${entityIds.length}` : ""} entities
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((id) => {
          const meta = nodeMetaMap[id] || { name: id, category: "DEFAULT", desc: "" };
          const c = getColor(meta.category);

          return (
            <button
              key={id}
              type="button"
              className="mb-1.5 flex w-full min-w-0 items-center gap-2.5 rounded-[20px] border border-[#2a3347] bg-[#1c2230] px-3 py-2 text-left transition hover:border-[#5b8dff] hover:bg-[#1e2840]"
              onClick={() => onFocusNode(id)}
            >
              <div className="size-[9px] shrink-0 rounded-full border-2" style={{ background: c.bg, borderColor: c.border }} />
              <div className="min-w-0">
                <div className="truncate text-[0.7rem] font-bold text-[#cdd6f4]">{meta.name}</div>
                <div className="truncate text-[0.57rem] uppercase tracking-[0.08em] opacity-80" style={{ color: c.accent }}>
                  {meta.category || "DEFAULT"}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && query && (
          <div className="py-4 text-center text-[0.65rem] text-[#6272a4]">No matches</div>
        )}
      </div>
    </div>
  );
}
