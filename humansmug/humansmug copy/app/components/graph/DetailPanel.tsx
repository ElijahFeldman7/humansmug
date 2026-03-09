import { getColor } from "@/app/lib/graph/constants";
import type { DetailState } from "@/app/lib/graph/types";

type DetailPanelProps = {
  detail: DetailState;
  forceOpen?: boolean;
  emptyLabel?: string;
};

export function DetailPanel({ detail, forceOpen = false, emptyLabel }: DetailPanelProps) {
  const isOpen = forceOpen || Boolean(detail);
  return (
    <div
      className={`overflow-hidden border-b border-[#2a3347] transition-[max-height] duration-300 ease-in-out ${
        isOpen ? "max-h-[230px]" : "max-h-0"
      }`}
    >
      <div className="p-3.5">
        {!detail ? (
          forceOpen ? (
            <div className="text-[0.7rem] text-[#6272a4]">
              {emptyLabel || "Select an item to view details."}
            </div>
          ) : null
        ) : detail.kind === "node" ? (
          <NodeDetail detail={detail} />
        ) : (
          <EdgeDetail detail={detail} />
        )}
      </div>
    </div>
  );
}

function NodeDetail({ detail }: { detail: Extract<DetailState, { kind: "node" }> }) {
  const c = getColor(detail.data.category);

  return (
    <>
      <div className="mb-2.5 flex items-start gap-2.5">
        <div
          className="grid size-[30px] shrink-0 place-items-center rounded-full border-2 text-[0.58rem] font-bold tracking-[0.04em]"
          style={{ background: c.bg, borderColor: c.border, color: c.accent }}
        >
          {(detail.data.category || "?")[0]}
        </div>
        <div>
          <div className="break-words text-[0.83rem] font-bold leading-[1.3]" style={{ color: c.accent }}>
            {detail.data.name}
          </div>
          <div className="mt-0.5 text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
            {detail.data.category}
          </div>
        </div>
      </div>
      <div className="border-t border-[#2a3347] pt-2.5 text-[0.7rem] leading-[1.65] text-[#6272a4]">
        {detail.data.desc || <em className="opacity-35">No description available</em>}
      </div>
    </>
  );
}

function EdgeDetail({ detail }: { detail: Extract<DetailState, { kind: "edge" }> }) {
  const pct = Math.round((detail.data.strength / 10) * 100);

  return (
    <>
      <div className="mb-2.5 flex items-start gap-2.5">
        <div className="grid size-[30px] shrink-0 place-items-center rounded-full border-2 border-[#4af0b0] bg-[#1c2230] text-[0.58rem] font-bold tracking-[0.04em] text-[#4af0b0]">
          {"<->"}
        </div>
        <div>
          <div className="break-words text-[0.83rem] font-bold leading-[1.3] text-[#cdd6f4]">
            {detail.data.label}
          </div>
          <div className="mt-0.5 text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
            {`${detail.data.source} -> ${detail.data.target}`}
          </div>
        </div>
      </div>
      <div className="border-t border-[#2a3347] pt-2.5 text-[0.7rem] leading-[1.65] text-[#6272a4]">
        <div className="mt-2.5 flex items-center gap-2">
          <span className="whitespace-nowrap text-[0.64rem]">Strength</span>
          <div className="h-1 flex-1 overflow-hidden rounded bg-[#2a3347]">
            <div className="h-full rounded bg-[#4af0b0]" style={{ width: `${pct}%` }} />
          </div>
          <span className="whitespace-nowrap text-[0.64rem]">{`${detail.data.strength}/10`}</span>
        </div>
      </div>
    </>
  );
}
