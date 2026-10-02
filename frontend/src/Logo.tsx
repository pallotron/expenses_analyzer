/**
 * The app's mark: three ranked bars in the income, essential and expense
 * colours, like the Summary's lists. frontend/public/favicon.svg is the same
 * drawing; change both together.
 */
export function Logo(props: { size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#0f172a" />
      <rect x="15" y="15" width="34" height="8" rx="4" fill="#2f9e66" />
      <rect x="15" y="28" width="25" height="8" rx="4" fill="#d89a2a" />
      <rect x="15" y="41" width="15" height="8" rx="4" fill="#d9473f" />
    </svg>
  );
}
