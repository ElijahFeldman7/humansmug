import { getColor } from "@/app/lib/graph/constants";

type LegendProps = {
  types: string[];
};

export function Legend({ types }: LegendProps) {
  return (
    <div className="space-y-1.5">
      {types.map((type) => {
        const c = getColor(type);
        return (
          <div key={type} className="flex items-center gap-2 text-[0.67rem] text-[#6272a4]">
            <div
              className="size-2.5 rounded-full border-2"
              style={{ background: c.bg, borderColor: c.border }}
            />
            <span>{type}</span>
          </div>
        );
      })}
    </div>
  );
}
