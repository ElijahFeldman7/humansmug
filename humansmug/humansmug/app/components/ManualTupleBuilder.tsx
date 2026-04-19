"use client";

import { useMemo, useState } from "react";

type EntityType =
  | "PERSON"
  | "LOCATION"
  | "ORGANIZATION"
  | "MEANS_OF_TRANSPORTATION"
  | "MEANS_OF_COMMUNICATION"
  | "ROUTES"
  | "SMUGGLED_ITEMS";

type ManualEntity = {
  id: string;
  name: string;
  type: EntityType;
  desc: string;
};

type ManualRelationship = {
  id: string;
  source: string;
  target: string;
  desc: string;
  strength: number;
};

type ChunkItem = {
  id: string;
  text: string;
  entities: ManualEntity[];
  relationships: ManualRelationship[];
};

const ENTITY_TYPES: EntityType[] = [
  "PERSON",
  "LOCATION",
  "ORGANIZATION",
  "MEANS_OF_TRANSPORTATION",
  "MEANS_OF_COMMUNICATION",
  "ROUTES",
  "SMUGGLED_ITEMS",
];

const ENTITY_TYPE_DESCRIPTIONS: Array<{ type: EntityType; desc: string }> = [
  {
    type: "PERSON",
    desc: "Short or full name of a person from any region, including smugglers, undocumented non-citizens, border patrol agents, and related individuals.",
  },
  {
    type: "LOCATION",
    desc: "Any geographic location such as city, country, county, state, continent, district, or similar place.",
  },
  {
    type: "ORGANIZATION",
    desc: "Companies, organized criminal groups, drug cartels, smuggling rings, or other named organizations.",
  },
  {
    type: "MEANS_OF_TRANSPORTATION",
    desc: "How someone moves between places, such as car, truck, bus, van, 18-wheeler, or similar transport.",
  },
  {
    type: "MEANS_OF_COMMUNICATION",
    desc: "How communication is performed, such as phone, WhatsApp, radio, email, or similar channels.",
  },
  {
    type: "ROUTES",
    desc: "Road names and travel corridors such as roads, freeways, highways, and other route identifiers.",
  },
  {
    type: "SMUGGLED_ITEMS",
    desc: "Illegally transported goods involved in smuggling, including drugs, weapons, contraband, and similar items.",
  },
];

function splitIntoSentences(input: string): string[] {
  const normalized = input
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const matches = normalized.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g);
  if (!matches) return [normalized];

  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function chunkSentences(sentences: string[], sentenceCount: 3 | 4): ChunkItem[] {
  const chunks: ChunkItem[] = [];
  for (let index = 0; index < sentences.length; index += sentenceCount) {
    const text = sentences.slice(index, index + sentenceCount).join(" ").trim();
    if (!text) continue;
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      text,
      entities: [],
      relationships: [],
    });
  }
  return chunks;
}

function escapeCsv(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function tupleSafe(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTupleOutput(chunk: ChunkItem): string {
  const lines: string[] = [];

  chunk.entities.forEach((entity) => {
    const name = tupleSafe(entity.name).toUpperCase();
    const type = tupleSafe(entity.type).toUpperCase();
    const desc = tupleSafe(entity.desc);
    lines.push(
      `("entity"{tuple_delimiter}${name}{tuple_delimiter}${type}{tuple_delimiter}${desc}) {record_delimiter}`,
    );
  });

  chunk.relationships.forEach((relationship) => {
    const source = tupleSafe(relationship.source).toUpperCase();
    const target = tupleSafe(relationship.target).toUpperCase();
    const desc = tupleSafe(relationship.desc);
    const strength = Number.isFinite(relationship.strength)
      ? Math.max(1, Math.min(10, Math.round(relationship.strength)))
      : 10;

    lines.push(
      `("relationship"{tuple_delimiter}${source}{tuple_delimiter}${target}{tuple_delimiter}${desc}{tuple_delimiter}${strength}) {record_delimiter}`,
    );
  });

  lines.push("{completion_delimiter}");
  return lines.join("\n");
}

export function ManualTupleBuilder() {
  const [rawText, setRawText] = useState("");
  const [sentenceCount, setSentenceCount] = useState<3 | 4>(3);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);

  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("PERSON");
  const [entityDesc, setEntityDesc] = useState("");

  const [relSource, setRelSource] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relDesc, setRelDesc] = useState("");
  const [relStrength, setRelStrength] = useState("10");

  const activeChunk = useMemo(
    () => chunks.find((chunk) => chunk.id === activeChunkId) || null,
    [chunks, activeChunkId],
  );

  const totalSentenceCount = useMemo(() => splitIntoSentences(rawText).length, [rawText]);

  const totalEntityCount = useMemo(
    () => chunks.reduce((sum, chunk) => sum + chunk.entities.length, 0),
    [chunks],
  );

  const totalRelationshipCount = useMemo(
    () => chunks.reduce((sum, chunk) => sum + chunk.relationships.length, 0),
    [chunks],
  );

  const csvText = useMemo(() => {
    const header = ["chunk_index", "input_text", "output_text"].join(",");
    const rows = chunks.map((chunk, idx) => {
      const output = formatTupleOutput(chunk);
      return [String(idx + 1), escapeCsv(chunk.text), escapeCsv(output)].join(",");
    });
    return [header, ...rows].join("\n");
  }, [chunks]);

  const handleCreateChunks = () => {
    const sentences = splitIntoSentences(rawText);
    const nextChunks = chunkSentences(sentences, sentenceCount);
    setChunks(nextChunks);
    setActiveChunkId(nextChunks[0]?.id || null);

    setEntityName("");
    setEntityType("PERSON");
    setEntityDesc("");
    setRelSource("");
    setRelTarget("");
    setRelDesc("");
    setRelStrength("10");
  };

  const handleAddEntity = () => {
    if (!activeChunk) return;
    const name = entityName.trim();
    const desc = entityDesc.trim();
    if (!name || !desc) return;

    const entity: ManualEntity = {
      id: `entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      type: entityType,
      desc,
    };

    setChunks((prev) =>
      prev.map((chunk) =>
        chunk.id === activeChunk.id
          ? { ...chunk, entities: [...chunk.entities, entity] }
          : chunk,
      ),
    );

    setEntityName("");
    setEntityDesc("");

    if (!relSource) setRelSource(name);
  };

  const handleAddRelationship = () => {
    if (!activeChunk) return;
    const source = relSource.trim();
    const target = relTarget.trim();
    const desc = relDesc.trim();
    const strength = Number.parseInt(relStrength, 10);

    if (!source || !target || !desc) return;

    const relationship: ManualRelationship = {
      id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
      target,
      desc,
      strength: Number.isFinite(strength) ? strength : 10,
    };

    setChunks((prev) =>
      prev.map((chunk) =>
        chunk.id === activeChunk.id
          ? { ...chunk, relationships: [...chunk.relationships, relationship] }
          : chunk,
      ),
    );

    setRelDesc("");
    setRelStrength("10");
  };

  const removeEntity = (entityId: string) => {
    if (!activeChunk) return;

    setChunks((prev) =>
      prev.map((chunk) => {
        if (chunk.id !== activeChunk.id) return chunk;

        const removed = chunk.entities.find((entity) => entity.id === entityId);
        if (!removed) return chunk;

        const remainingEntities = chunk.entities.filter((entity) => entity.id !== entityId);
        const removedUpper = removed.name.toUpperCase();

        return {
          ...chunk,
          entities: remainingEntities,
          relationships: chunk.relationships.filter(
            (relationship) =>
              relationship.source.toUpperCase() !== removedUpper &&
              relationship.target.toUpperCase() !== removedUpper,
          ),
        };
      }),
    );
  };

  const removeRelationship = (relationshipId: string) => {
    if (!activeChunk) return;
    setChunks((prev) =>
      prev.map((chunk) =>
        chunk.id === activeChunk.id
          ? {
              ...chunk,
              relationships: chunk.relationships.filter((rel) => rel.id !== relationshipId),
            }
          : chunk,
      ),
    );
  };

  const handleDownloadCsv = () => {
    if (!chunks.length) return;

    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manual_tuple_builder_output.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleCopyChunkOutput = async () => {
    if (!activeChunk) return;
    const output = formatTupleOutput(activeChunk);
    await navigator.clipboard.writeText(output);
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_20%_20%,rgba(91,141,255,0.15),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(74,240,176,0.15),transparent_38%),#0d0f14] px-4 py-4 md:px-6 md:py-5">
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 md:grid-cols-[1.1fr_1fr]">
        <section className="rounded-2xl border border-[#2a3347] bg-[#11151e]/95 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[#7f8bb0]">
                Input
              </div>
              <h2 className="mt-1 text-[0.94rem] font-semibold tracking-[0.02em] text-[#e5edff]">
                Paste Narrative Text
              </h2>
            </div>
            <label className="flex items-center gap-2 rounded-full border border-[#30405f] bg-[#0f1628] px-3 py-1.5 text-[0.66rem] text-[#9ab0e8]">
              Sentences per chunk
              <select
                value={sentenceCount}
                onChange={(event) => setSentenceCount(Number(event.target.value) as 3 | 4)}
                className="rounded-md border border-[#3f5378] bg-[#121a2f] px-1.5 py-0.5 text-[0.66rem] text-[#e5edff] outline-none"
              >
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          </div>

          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="Paste report text here. Example: The agents made an investigatory stop and discovered eight illegal aliens in the truck, including the driver, Munoz-Martinez."
            className="min-h-[220px] w-full rounded-xl border border-[#2d3b58] bg-[#0d1322] px-3 py-3 text-[0.74rem] leading-6 text-[#d8e3ff] outline-none transition placeholder:text-[#6f7fa8] focus:border-[#5b8dff]"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCreateChunks}
              disabled={!rawText.trim()}
              className="rounded-lg bg-[#4af0b0] px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[#0d0f14] transition hover:bg-[#6ff5be] disabled:cursor-not-allowed disabled:bg-[#2f6f58]"
            >
              Create Chunks
            </button>
            <div className="rounded-lg border border-[#30405f] bg-[#101827] px-3 py-2 text-[0.66rem] text-[#8ba2d4]">
              {totalSentenceCount} sentences detected
            </div>
            <div className="rounded-lg border border-[#30405f] bg-[#101827] px-3 py-2 text-[0.66rem] text-[#8ba2d4]">
              {chunks.length} chunks
            </div>
          </div>

          {chunks.length > 0 && (
            <div className="mt-4 grid gap-2">
              <div className="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#7f8bb0]">
                Chunks
              </div>
              <div className="max-h-[260px] overflow-y-auto pr-1">
                <div className="space-y-2">
                  {chunks.map((chunk, index) => {
                    const active = chunk.id === activeChunkId;
                    return (
                      <button
                        key={chunk.id}
                        type="button"
                        onClick={() => setActiveChunkId(chunk.id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          active
                            ? "border-[#4af0b0] bg-[#102018]"
                            : "border-[#2a3347] bg-[#0d1322] hover:border-[#5b8dff]"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#8ca3d6]">
                            Chunk {index + 1}
                          </span>
                          <span className="text-[0.58rem] text-[#6f83b3]">
                            {chunk.entities.length} entities / {chunk.relationships.length} relationships
                          </span>
                        </div>
                        <div className="line-clamp-3 text-[0.7rem] leading-5 text-[#d8e3ff]">{chunk.text}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#2a3347] bg-[#11151e]/95 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[#7f8bb0]">
                Annotation
              </div>
              <h2 className="mt-1 text-[0.94rem] font-semibold tracking-[0.02em] text-[#e5edff]">
                Entities + Relationships
              </h2>
            </div>
            {activeChunk && (
              <button
                type="button"
                onClick={() => void handleCopyChunkOutput()}
                className="rounded-lg border border-[#4f69a0] bg-[#15213a] px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[#9db6ef] transition hover:border-[#5b8dff] hover:text-[#bfd0ff]"
              >
                Copy Chunk Output
              </button>
            )}
          </div>

          {!activeChunk ? (
            <div className="rounded-xl border border-dashed border-[#2a3347] bg-[#0f1420] px-4 py-5 text-[0.72rem] text-[#7384ad]">
              Create chunks and select one to begin annotation.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#2a3347] bg-[#0d1322] px-3 py-3 text-[0.72rem] leading-6 text-[#d8e3ff]">
                {activeChunk.text}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[#2a3347] bg-[#0e1320] p-3">
                  <div className="mb-2 text-[0.63rem] font-bold uppercase tracking-[0.12em] text-[#7f8bb0]">
                    Add Entity
                  </div>
                  <div className="space-y-2">
                    <input
                      value={entityName}
                      onChange={(event) => setEntityName(event.target.value)}
                      placeholder="Entity name"
                      className="w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none placeholder:text-[#60729e] focus:border-[#5b8dff]"
                    />
                    <select
                      value={entityType}
                      onChange={(event) => setEntityType(event.target.value as EntityType)}
                      className="w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none focus:border-[#5b8dff]"
                    >
                      {ENTITY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <div className="rounded-md border border-[#2a3347] bg-[#0f1728] px-2.5 py-2 text-[0.62rem] leading-5 text-[#8ca3d6]">
                      {ENTITY_TYPE_DESCRIPTIONS.find((item) => item.type === entityType)?.desc}
                    </div>
                    <textarea
                      value={entityDesc}
                      onChange={(event) => setEntityDesc(event.target.value)}
                      placeholder="Description"
                      className="min-h-[74px] w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none placeholder:text-[#60729e] focus:border-[#5b8dff]"
                    />
                    <button
                      type="button"
                      onClick={handleAddEntity}
                      className="w-full rounded-md bg-[#4af0b0] py-2 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-[#0d0f14] transition hover:bg-[#6ff5be]"
                    >
                      Add Entity
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[#2a3347] bg-[#0e1320] p-3">
                  <div className="mb-2 text-[0.63rem] font-bold uppercase tracking-[0.12em] text-[#7f8bb0]">
                    Add Relationship
                  </div>
                  <div className="space-y-2">
                    <select
                      value={relSource}
                      onChange={(event) => setRelSource(event.target.value)}
                      className="w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none focus:border-[#5b8dff]"
                    >
                      <option value="">Source entity</option>
                      {activeChunk.entities.map((entity) => (
                        <option key={entity.id} value={entity.name}>
                          {entity.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={relTarget}
                      onChange={(event) => setRelTarget(event.target.value)}
                      className="w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none focus:border-[#5b8dff]"
                    >
                      <option value="">Target entity</option>
                      {activeChunk.entities.map((entity) => (
                        <option key={entity.id} value={entity.name}>
                          {entity.name}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={relDesc}
                      onChange={(event) => setRelDesc(event.target.value)}
                      placeholder="Relationship description"
                      className="min-h-[74px] w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none placeholder:text-[#60729e] focus:border-[#5b8dff]"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-[0.63rem] text-[#8ca3d6]">Strength</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={relStrength}
                        onChange={(event) => setRelStrength(event.target.value)}
                        className="w-full rounded-md border border-[#32415f] bg-[#0c1220] px-2.5 py-2 text-[0.7rem] text-[#e5edff] outline-none focus:border-[#5b8dff]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddRelationship}
                      className="w-full rounded-md bg-[#5b8dff] py-2 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-[#0d0f14] transition hover:bg-[#7aa4ff]"
                    >
                      Add Relationship
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[#2a3347] bg-[#0d1322] p-3">
                  <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#7f8bb0]">
                    Entities ({activeChunk.entities.length})
                  </div>
                  <div className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                    {activeChunk.entities.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[#2a3347] px-2.5 py-2 text-[0.66rem] text-[#7384ad]">
                        No entities yet.
                      </div>
                    ) : (
                      activeChunk.entities.map((entity) => (
                        <div key={entity.id} className="rounded-md border border-[#2a3347] bg-[#101827] p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[0.68rem] font-semibold text-[#dce8ff]">{entity.name}</div>
                              <div className="text-[0.58rem] uppercase tracking-[0.1em] text-[#86a0d8]">
                                {entity.type}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeEntity(entity.id)}
                              className="text-[0.6rem] text-[#7a89b0] transition hover:text-[#ff7d7d]"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="mt-1 text-[0.64rem] leading-5 text-[#a8bcf0]">{entity.desc}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#2a3347] bg-[#0d1322] p-3">
                  <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#7f8bb0]">
                    Relationships ({activeChunk.relationships.length})
                  </div>
                  <div className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                    {activeChunk.relationships.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[#2a3347] px-2.5 py-2 text-[0.66rem] text-[#7384ad]">
                        No relationships yet.
                      </div>
                    ) : (
                      activeChunk.relationships.map((relationship) => (
                        <div key={relationship.id} className="rounded-md border border-[#2a3347] bg-[#101827] p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[0.66rem] font-semibold text-[#dce8ff]">
                              {relationship.source} {"->"} {relationship.target}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeRelationship(relationship.id)}
                              className="text-[0.6rem] text-[#7a89b0] transition hover:text-[#ff7d7d]"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="mt-1 text-[0.64rem] leading-5 text-[#a8bcf0]">{relationship.desc}</p>
                          <div className="mt-1 text-[0.58rem] uppercase tracking-[0.08em] text-[#86a0d8]">
                            Strength: {Math.max(1, Math.min(10, Math.round(relationship.strength)))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="mx-auto mt-4 w-full max-w-[1500px] rounded-2xl border border-[#2a3347] bg-[#11151e]/95 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[#7f8bb0]">
              Export
            </div>
            <h2 className="mt-1 text-[0.94rem] font-semibold tracking-[0.02em] text-[#e5edff]">
              CSV With Input + Formatted Output
            </h2>
          </div>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!chunks.length}
            className="rounded-lg bg-[#f4c95d] px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[#1b1505] transition hover:bg-[#ffd983] disabled:cursor-not-allowed disabled:bg-[#6c5c30]"
          >
            Download CSV
          </button>
        </div>

        <div className="mb-2 grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-[#33415f] bg-[#0e1627] px-3 py-2 text-[0.65rem] text-[#90a7dd]">
            Chunks: {chunks.length}
          </div>
          <div className="rounded-lg border border-[#33415f] bg-[#0e1627] px-3 py-2 text-[0.65rem] text-[#90a7dd]">
            Entities: {totalEntityCount}
          </div>
          <div className="rounded-lg border border-[#33415f] bg-[#0e1627] px-3 py-2 text-[0.65rem] text-[#90a7dd]">
            Relationships: {totalRelationshipCount}
          </div>
        </div>

        <div className="max-h-[260px] overflow-y-auto rounded-xl border border-[#2a3347] bg-[#0d1322] p-3">
          <pre className="whitespace-pre-wrap text-[0.64rem] leading-5 text-[#bfd0ff]">
            {csvText || "Create chunks to preview CSV output."}
          </pre>
        </div>
      </section>
    </div>
  );
}
