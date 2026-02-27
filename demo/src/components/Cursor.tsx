import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

type CursorPoint = {
  x: number;
  y: number;
  frame: number;
};

export const Cursor = ({ points }: { points: CursorPoint[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (points.length === 0) return null;

  // Find current segment
  let x = points[0].x;
  let y = points[0].y;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];

    if (frame >= from.frame && frame <= to.frame) {
      const progress = spring({
        frame: frame - from.frame,
        fps,
        durationInFrames: to.frame - from.frame,
        config: { damping: 20, stiffness: 120 },
      });
      x = interpolate(progress, [0, 1], [from.x, to.x]);
      y = interpolate(progress, [0, 1], [from.y, to.y]);
      break;
    } else if (frame > to.frame) {
      x = to.x;
      y = to.y;
    }
  }

  // Fade in
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        zIndex: 100,
        pointerEvents: "none",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 3L19 12L12 13L9 20L5 3Z"
          fill="white"
          stroke="black"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
};
