import { getColor } from "@/app/lib/graph/constants";
import type { NodeMeta } from "@/app/lib/graph/types";

type EntityListProps = {
  entityIds: string[];
  nodeMetaMap: Record<string, NodeMeta>;
  onFocusNode: (id: string) => void;
};

export function EntityList({ entityIds, nodeMetaMap, onFocusNode }: EntityListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {entityIds.map((id) => {
        const meta = nodeMetaMap[id] || { name: id, category: "DEFAULT", desc: "" };
        const c = getColor(meta.category);

        return (
          <button
            key={id}
            type="button"
            className="mb-1.5 flex w-full items-center gap-2.5 rounded-[20px] border border-[#2a3347] bg-[#1c2230] px-3 py-2 text-left transition hover:border-[#5b8dff] hover:bg-[#1e2840]"
            onClick={() => onFocusNode(id)}
          >
            <div className="size-[9px] shrink-0 rounded-full border-2" style={{ background: c.bg, borderColor: c.border }} />
            <div>
              <div className="text-[0.7rem] font-bold text-[#cdd6f4]">{meta.name}</div>
              <div className="text-[0.57rem] uppercase tracking-[0.08em] opacity-80" style={{ color: c.accent }}>
                {meta.category || "DEFAULT"}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
