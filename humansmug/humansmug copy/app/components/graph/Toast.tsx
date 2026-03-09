type ToastProps = {
  message: string;
  visible: boolean;
};

export function Toast({ message, visible }: ToastProps) {
  return (
    <div
      className={`pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-md border border-[#ff6b6b] bg-[#1c2230] px-4 py-2 text-[0.72rem] text-[#ff6b6b] transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-14"
      }`}
    >
      {message}
    </div>
  );
}
