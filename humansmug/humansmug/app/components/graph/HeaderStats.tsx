type HeaderStatsProps = {
  nodesCount: number;
  edgesCount: number;
};

export function HeaderStats({ nodesCount, edgesCount }: HeaderStatsProps) {
  return (
    <div className="flex flex-1 items-center gap-4">
      <span className="[font-family:var(--font-syne)] text-[1.05rem] font-extrabold tracking-tight text-white">
        LINK<span className="text-[#4af0b0]">-KG</span>
      </span>

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
    </div>
  );
}
