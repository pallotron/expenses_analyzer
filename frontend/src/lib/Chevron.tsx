/** A stroke chevron; replaces the small ◂ ▸ ▴ ▾ glyphs, which render tiny. */
export function Chevron(props: { dir: "left" | "right" | "up" | "down"; size?: number; className?: string }) {
  const size = props.size ?? 16;
  const d = { left: "M15 18l-6-6 6-6", right: "M9 18l6-6-6-6", up: "M18 15l-6-6-6 6", down: "M6 9l6 6 6-6" }[props.dir];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <path d={d} />
    </svg>
  );
}
