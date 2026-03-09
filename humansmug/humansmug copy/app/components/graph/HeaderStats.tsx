type HeaderStatsProps = {
  nodesCount: number;
  edgesCount: number;
};

export function HeaderStats({ nodesCount, edgesCount }: HeaderStatsProps) {
  return (
    <header className="z-10 flex items-center gap-4 border-b border-[#2a3347] bg-[#141820] px-5 py-3 md:px-6">
      <div className="flex items-center gap-2.5">
        <div className="grid size-8 place-items-center rounded-full bg-[#4af0b0]">
          <svg viewBox="0 0 24 24" fill="none" stroke="#0d0f14" strokeWidth="2.5" strokeLinecap="round" className="size-4">
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="6" r="2" />
            <circle cx="12" cy="18" r="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="7" y1="7.5" x2="11" y2="16.5" />
            <line x1="17" y1="7.5" x2="13" y2="16.5" />
          </svg>
        </div>
        <span className="[font-family:var(--font-syne)] text-[1.05rem] font-extrabold text-white">
          Graph<span className="text-[#4af0b0]">Mind</span>
        </span>
      </div>

      <div className="ml-auto flex gap-5 text-right text-[0.65rem] text-[#6272a4]">
        <div className="flex flex-col gap-0.5">
          <strong className="text-base font-bold text-[#cdd6f4]">{nodesCount}</strong>
          <span>nodes</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <strong className="text-base font-bold text-[#cdd6f4]">{edgesCount}</strong>
          <span>edges</span>
        </div>
      </div>
    </header>
  );
}
