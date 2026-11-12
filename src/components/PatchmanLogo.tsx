interface PatchmanLogoProps {
  /** Pixel size of the rendered icon. Width and height share this value
   *  since the master art is square. Defaults to 22 — slightly larger
   *  than the lucide icon it replaces so the outlined Pacman + plane
   *  composition reads at TopBar density. */
  size?: number;
  className?: string;
  /** When true, render the small-size variant: no motion lines, dropped
   *  airplane fold, slightly thicker strokes — preserves recognition at
   *  ≤32 px (TopBar, dropdown menus). Defaults to true under 40 px. */
  compact?: boolean;
}

/**
 * Inline SVG mark: yellow Pacman chasing a fleeing orange paper airplane.
 * Geometry mirrors `src/assets/brand/patchman-logo.svg` (the master used
 * for the app icon / favicon export). Component instead of `<img>` so it
 * skips a network round-trip for a sub-kilobyte asset and renders crisp
 * regardless of the surrounding font weight.
 *
 * The compact variant strips the speed lines and the fold triangle — at
 * 22 px they collapse into noisy pixels under anti-aliasing and actually
 * hurt legibility. Master shape (Pacman + airplane + outlines) survives.
 */
export function PatchmanLogo({ size = 22, className, compact }: PatchmanLogoProps) {
  const isCompact = compact ?? size < 40;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="PatchMan"
    >
      {!isCompact && (
        <g stroke="#1A2940" strokeWidth={14} strokeLinecap="round" fill="none" opacity={0.55}>
          <line x1="120" y1="420" x2="220" y2="420" />
          <line x1="70" y1="512" x2="190" y2="512" />
          <line x1="120" y1="604" x2="220" y2="604" />
        </g>
      )}
      <path
        d="M 512 512 L 757 306 A 320 320 0 1 0 757 718 Z"
        fill="#FFD43B"
        stroke="#1A2940"
        strokeWidth={isCompact ? 32 : 20}
        strokeLinejoin="round"
      />
      <ellipse cx="448" cy="312" rx="22" ry="34" fill="#1A2940" />
      {isCompact ? (
        <path
          d="M 810 462 L 980 512 L 810 562 Z"
          fill="#FF6C37"
          stroke="#1A2940"
          strokeWidth={20}
          strokeLinejoin="round"
        />
      ) : (
        <g stroke="#1A2940" strokeWidth={14} strokeLinejoin="round">
          <path d="M 810 462 L 980 512 L 884 512 Z" fill="#FF6C37" />
          <path d="M 884 512 L 980 512 L 810 562 Z" fill="#D14817" />
        </g>
      )}
    </svg>
  );
}
