import type { Ref } from "react";

type GraphCanvasProps = {
  hasGraph: boolean;
  networkRef: Ref<HTMLDivElement>;
  onFitGraph: () => void;
  onTogglePhysics: () => void;
};

export function GraphCanvas({ hasGraph, networkRef, onFitGraph, onTogglePhysics }: GraphCanvasProps) {
  return (
    <div
      className="relative h-full min-h-[360px] overflow-hidden bg-[#0d0f14] md:min-h-0"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 30%, rgba(74,240,176,0.04) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(91,141,255,0.04) 0%, transparent 50%), linear-gradient(rgba(42,51,71,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(42,51,71,0.22) 1px, transparent 1px)",
        backgroundSize: "auto, auto, 40px 40px, 40px 40px",
      }}
    >
      {!hasGraph ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[0.78rem] text-[#6272a4]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-11 opacity-15">
            <circle cx="5" cy="5" r="2" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="12" cy="19" r="2" />
            <line x1="7" y1="5" x2="17" y2="5" />
            <line x1="6" y1="6.5" x2="11" y2="17.5" />
            <line x1="18" y1="6.5" x2="13" y2="17.5" />
          </svg>
          <p className="opacity-40">Paste tuple data and click Generate</p>
        </div>
      ) : null}

      <div ref={networkRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute right-3.5 top-3.5 z-10 flex gap-1.5">
        <button
          type="button"
          title="Fit to view"
          onClick={onFitGraph}
          className="grid size-[34px] place-items-center rounded-lg border border-[#2a3347] bg-[#141820] text-[#6272a4] transition hover:border-[#4af0b0] hover:bg-[#1c2230] hover:text-[#4af0b0]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[15px]">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>

        <button
          type="button"
          title="Toggle physics"
          onClick={onTogglePhysics}
          className="grid size-[34px] place-items-center rounded-lg border border-[#2a3347] bg-[#141820] text-[#6272a4] transition hover:border-[#4af0b0] hover:bg-[#1c2230] hover:text-[#4af0b0]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-[15px]">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
