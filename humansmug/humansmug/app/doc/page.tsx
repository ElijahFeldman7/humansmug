"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

function DocViewerInner() {
  const searchParams = useSearchParams();
  const file = searchParams.get("file") || "";
  const highlight = searchParams.get("highlight") || "";

  const [html, setHtml] = useState("");
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      setError("No file specified");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const res = await fetch(
          `/api/doc-viewer?file=${encodeURIComponent(file)}`,
        );
        const data = (await res.json()) as {
          html?: string;
          filename?: string;
          error?: string;
        };
        if (data.error) {
          setError(data.error);
        } else {
          setHtml(data.html || "");
          setFilename(data.filename || file);
        }
      } catch {
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [file]);

  // Highlight the sentence in the rendered HTML
  const highlightedHtml = useCallback(() => {
    if (!highlight || !html) return html;

    // Normalize whitespace for matching
    const normHighlight = highlight.replace(/\s+/g, "\\s+");
    try {
      const re = new RegExp(`(${normHighlight})`, "gi");
      const result = html.replace(
        re,
        '<mark class="doc-highlight" id="highlight-match">$1</mark>',
      );
      // Count matches
      const matches = html.match(re);
      setMatchCount(matches ? matches.length : 0);
      return result;
    } catch {
      return html;
    }
  }, [html, highlight]);

  // Scroll to first highlight after render
  useEffect(() => {
    if (!loading && highlight) {
      requestAnimationFrame(() => {
        const el = document.getElementById("highlight-match");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }, [loading, highlight, html]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14]">
        <div className="flex items-center gap-2 text-[#6272a4]">
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:0ms]" />
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:150ms]" />
          <span className="inline-block size-2 animate-bounce rounded-full bg-[#4af0b0] [animation-delay:300ms]" />
          <span className="ml-2">Loading document...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14]">
        <div className="rounded-xl border border-[#ff6b6b]/30 bg-[#141820] px-8 py-6 text-center">
          <h2 className="mb-2 text-lg font-bold text-[#ff6b6b]">Error</h2>
          <p className="text-[0.8rem] text-[#6272a4]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0d0f14] text-[#cdd6f4]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#2a3347] bg-[#141820]/95 px-6 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.82rem] font-bold">{filename}</h1>
            {highlight && (
              <p className="mt-0.5 text-[0.65rem] text-[#6272a4]">
                {matchCount > 0
                  ? `${matchCount} match${matchCount !== 1 ? "es" : ""} highlighted`
                  : "No matches found for highlight"}
              </p>
            )}
          </div>
          <a
            href="/"
            className="ml-4 shrink-0 rounded-lg border border-[#2a3347] px-3 py-1.5 text-[0.68rem] text-[#6272a4] transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
          >
            Back to Graph
          </a>
        </div>
      </header>

      {/* Document content */}
      <main className="mx-auto max-w-4xl px-6 py-8">
        <style>{`
          .doc-highlight {
            background: #4af0b033;
            border-bottom: 2px solid #4af0b0;
            color: #cdd6f4;
            padding: 2px 0;
            border-radius: 2px;
            scroll-margin-top: 100px;
          }
          .doc-content p { margin-bottom: 0.8em; line-height: 1.7; }
          .doc-content h1, .doc-content h2, .doc-content h3 {
            font-weight: 700;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            color: #cdd6f4;
          }
          .doc-content h1 { font-size: 1.3rem; }
          .doc-content h2 { font-size: 1.1rem; }
          .doc-content h3 { font-size: 0.95rem; }
          .doc-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
          }
          .doc-content td, .doc-content th {
            border: 1px solid #2a3347;
            padding: 6px 10px;
            font-size: 0.8rem;
          }
          .doc-content strong { color: #cdd6f4; }
          .doc-content em { color: #9aa6cf; }
          .doc-content ul, .doc-content ol { margin-left: 1.5em; margin-bottom: 0.8em; }
          .doc-content li { margin-bottom: 0.3em; }
        `}</style>
        <div
          ref={contentRef}
          className="doc-content text-[0.82rem] leading-[1.7] text-[#9aa6cf]"
          dangerouslySetInnerHTML={{ __html: highlightedHtml() }}
        />
      </main>
    </div>
  );
}

export default function DocViewer() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#0d0f14] text-[#6272a4]">
          Loading...
        </div>
      }
    >
      <DocViewerInner />
    </Suspense>
  );
}
