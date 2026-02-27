import { useCurrentFrame, interpolate } from "remotion";

type ClickPoint = {
  x: number;
  y: number;
  frame: number;
};

export const ClickEffects = ({ clicks }: { clicks: ClickPoint[] }) => {
  const frame = useCurrentFrame();

  return (
    <>
      {clicks.map((click, i) => {
        const elapsed = frame - click.frame;
        if (elapsed < 0 || elapsed > 20) return null;

        const scale = interpolate(elapsed, [0, 20], [0.3, 2.5], {
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(elapsed, [0, 5, 20], [0, 0.6, 0], {
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: click.x - 20,
              top: click.y - 20,
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "2px solid rgba(220, 38, 38, 0.8)",
              background: "rgba(220, 38, 38, 0.15)",
              transform: `scale(${scale})`,
              opacity,
              pointerEvents: "none",
              zIndex: 99,
            }}
          />
        );
      })}
    </>
  );
};
