// PROTOTYPE — throwaway floating variant switcher. Never ships: hidden outside dev.
import { useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  children,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  children?: ReactNode;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function cycle(step: number) {
    const next = variants[(index + step + variants.length) % variants.length];
    onChange(next.key);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-3 py-2 text-sm text-white shadow-2xl ring-2 ring-fuchsia-500">
      <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
        Prototype
      </span>
      <button
        onClick={() => cycle(-1)}
        className="rounded-full p-1 hover:bg-white/10"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-56 text-center font-medium">
        {variants[index].key} ({variants[index].name})
      </span>
      <button
        onClick={() => cycle(1)}
        className="rounded-full p-1 hover:bg-white/10"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {children}
    </div>
  );
}
