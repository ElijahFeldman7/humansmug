import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getColor } from "@/app/lib/graph/constants";
import type { DetailState } from "@/app/lib/graph/types";

type Citation = {
  docId: string;
  sentence: string;
  fileUrl?: string;
};

type CitationMap = {
  entities: Record<string, Citation[]>;
  edges: Record<string, Citation[]>;
};

type DetailPanelProps = {
  detail: DetailState;
  forceOpen?: boolean;
  emptyLabel?: string;
  nodeSummaries?: Record<string, string>;
  nodeSummaryLoading?: Record<string, boolean>;
  onFocusNode?: (id: string) => void;
  citationMap?: CitationMap;
};

export function DetailPanel({
  detail,
  forceOpen = false,
  emptyLabel,
  nodeSummaries,
  nodeSummaryLoading,
  onFocusNode,
  citationMap,
}: DetailPanelProps) {
  const isOpen = forceOpen || Boolean(detail);

  const citations: Citation[] = (() => {
    if (!detail || !citationMap) return [];
    if (detail.kind === "node") {
      return citationMap.entities[detail.data.name] || [];
    }
    // Edge keys in citationMap use format: SOURCE||TARGET||LABEL
    const edgeKey = `${detail.data.source}||${detail.data.target}||${detail.data.label}`;
    return citationMap.edges[edgeKey] || [];
  })();

  return (
    <div
      className={`overflow-y-auto transition-[max-height] duration-300 ease-in-out ${
        isOpen ? "max-h-none" : "max-h-0"
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
          <>
            <NodeDetail
              detail={detail}
              summary={nodeSummaries?.[detail.data.name]}
              summaryLoading={nodeSummaryLoading?.[detail.data.name]}
              onFocusNode={onFocusNode}
            />
            {citations.length > 0 && <CitationList citations={citations} />}
          </>
        ) : (
          <>
            <EdgeDetail detail={detail} />
            {citations.length > 0 && <CitationList citations={citations} />}
          </>
        )}
      </div>
    </div>
  );
}

function NodeDetail({
  detail,
  summary,
  summaryLoading,
  onFocusNode,
}: {
  detail: Extract<DetailState, { kind: "node" }>;
  summary?: string;
  summaryLoading?: boolean;
  onFocusNode?: (id: string) => void;
}) {
  const c = getColor(detail.data.category);
  const descs = detail.data.descs?.length ? detail.data.descs : detail.data.desc ? [detail.data.desc] : [];

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
      <div className="border-t border-[#2a3347] pt-2.5 text-[0.7rem] leading-[1.6] text-[#6272a4]">
        <div className="text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
          Summary
        </div>
        <div className="mt-1.5 rounded border border-[#2a3347] bg-[#0d0f14] px-2.5 py-2 text-[0.66rem] text-[#9aa6cf]">
          {summaryLoading ? (
            "Summarizing..."
          ) : summary ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(uri) => uri}
              components={{
                a: ({ href, children }) => {
                  const safeHref = String(href || "");
                  if (safeHref.startsWith("node:") && onFocusNode) {
                    let raw = safeHref.slice(5);
                    try {
                      raw = decodeURIComponent(raw);
                    } catch {
                      // keep raw
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => onFocusNode(raw)}
                        className="inline-flex items-center gap-1 rounded-full border border-[#4af0b0] bg-[#102018] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[#4af0b0] hover:border-[#6ff5be] hover:text-[#6ff5be]"
                      >
                        {children}
                      </button>
                    );
                  }
                  return <span>{children}</span>;
                },
              }}
            >
              {summary}
            </ReactMarkdown>
          ) : (
            <em className="opacity-35">No summary yet</em>
          )}
        </div>
        <div className="mt-2 text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
          Descriptions
        </div>
        {descs.length ? (
          <div className="mt-1.5 max-h-[120px] overflow-y-auto rounded border border-[#2a3347] bg-[#0d0f14] px-2.5 py-2 text-[0.66rem] text-[#9aa6cf]">
            <ul className="space-y-2">
              {descs.map((desc, idx) => (
                <li key={`${detail.data.name}-desc-${idx}`} className="leading-[1.5]">
                  {desc}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-1.5 text-[0.66rem] text-[#9aa6cf]">
            <em className="opacity-35">No descriptions available</em>
          </div>
        )}
      </div>
    </>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  // Group by docId
  const grouped = new Map<string, Citation[]>();
  for (const c of citations) {
    const existing = grouped.get(c.docId) || [];
    existing.push(c);
    grouped.set(c.docId, existing);
  }

  function docViewerUrl(cite: Citation) {
    const file = cite.fileUrl
      ? cite.fileUrl.replace(/^\/uploads\//, "")
      : cite.docId;
    return `/doc?file=${encodeURIComponent(file)}&highlight=${encodeURIComponent(cite.sentence)}`;
  }

  return (
    <div className="mt-3 border-t border-[#2a3347] pt-2.5">
      <div className="text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
        Sources ({citations.length})
      </div>
      <div className="mt-1.5 max-h-[200px] space-y-2 overflow-y-auto">
        {[...grouped.entries()].map(([docId, cites]) => (
          <div
            key={docId}
            className="rounded border border-[#2a3347] bg-[#0d0f14] px-2.5 py-2"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[0.6rem] font-semibold text-[#5b8dff]">
                {docId}
              </span>
              <span className="text-[0.55rem] text-[#6272a4]">
                {cites.length} mention{cites.length !== 1 ? "s" : ""}
              </span>
            </div>
            <ul className="space-y-1.5">
              {cites.map((cite, i) => (
                <li key={i}>
                  <a
                    href={docViewerUrl(cite)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block cursor-pointer rounded px-1.5 py-1 text-[0.64rem] leading-[1.5] text-[#9aa6cf] transition hover:bg-[#1c2230]"
                  >
                    <span className="mr-1 text-[#4af0b0]">&ldquo;</span>
                    {cite.sentence}
                    <span className="ml-1 text-[#4af0b0]">&rdquo;</span>
                    <span className="ml-1.5 inline-block text-[0.55rem] text-[#5b8dff] opacity-0 transition group-hover:opacity-100">
                      View in doc &rarr;
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function EdgeDetail({ detail }: { detail: Extract<DetailState, { kind: "edge" }> }) {
  const pct = Math.round((detail.data.strength / 10) * 100);
  const sentence = detail.data.evidence || detail.data.label;

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
        <div className="mt-2 text-[0.58rem] uppercase tracking-[0.1em] text-[#6272a480]">
          Sentence
        </div>
        <div className="mt-1.5 rounded border border-[#2a3347] bg-[#0d0f14] px-2.5 py-2 text-[0.66rem] text-[#9aa6cf]">
          {sentence}
        </div>
      </div>
    </>
  );
}
