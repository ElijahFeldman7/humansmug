type SidebarInputProps = {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onRenderSample: () => void;
  onLoadFile: (file: File) => void;
  isLoading: boolean;
};

export function SidebarInput({
  value,
  onChange,
  onGenerate,
  onRenderSample,
  onLoadFile,
  isLoading,
}: SidebarInputProps) {
  return (
    <div className="border-b border-[#2a3347] px-4 py-3.5">
      <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#6272a4]">
        Source Text
      </div>
      <textarea
        id="graphInput"
        placeholder="Paste plain text. The model will convert it to tuple format for KG rendering."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[170px] w-full resize-y rounded-md border border-[#2a3347] bg-[#0d0f14] px-3 py-2.5 text-[0.67rem] leading-[1.5] text-[#cdd6f4] outline-none transition placeholder:text-[#6272a4]/70 focus:border-[#5b8dff]"
      />
      <label className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#2a3347] bg-[#0d0f14] px-3 py-2 text-[0.68rem] text-[#9aa6cf] transition hover:border-[#4af0b0] hover:text-[#cdd6f4]">
        <input
          type="file"
          accept=".txt,.md,.csv,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onLoadFile(file);
            }
            event.currentTarget.value = "";
          }}
        />
        Upload file for input
      </label>
      <button
        type="button"
        onClick={onGenerate}
        disabled={isLoading}
        className="mt-2.5 w-full rounded-md bg-[#4af0b0] py-2 text-[0.78rem] font-bold tracking-[0.05em] text-[#0d0f14] transition hover:bg-[#6ff5be] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#2f6f58] disabled:text-[#0d0f14]/70"
      >
        {isLoading ? "Generating KG..." : "Generate KG"}
      </button>
      <button
        type="button"
        onClick={onRenderSample}
        className="mt-2 w-full rounded-md border border-[#2a3347] bg-[#141820] py-2 text-[0.72rem] font-semibold tracking-[0.06em] text-[#cdd6f4] transition hover:border-[#4af0b0] hover:text-[#4af0b0]"
      >
        Render Sample
      </button>
    </div>
  );
}
