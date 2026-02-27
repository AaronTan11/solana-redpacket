import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors, fullScreen } from "../styles";

const archBoxes = [
  { label: "Solana Program", desc: "Pinocchio · 57KB", color: colors.red, x: 960, y: 220 },
  { label: "Frontend", desc: "TanStack Start · Vercel", color: "#3b82f6", x: 560, y: 420 },
  { label: "Blinks Server", desc: "Axum · Solana Actions", color: colors.gold, x: 1360, y: 420 },
];

const techs = [
  { name: "Pinocchio", color: colors.red },
  { name: "TanStack Start", color: "#3b82f6" },
  { name: "Axum", color: colors.gold },
  { name: "@solana/kit", color: "#14b8a6" },
  { name: "shadcn/ui", color: "#a855f7" },
  { name: "Helius", color: "#f97316" },
];

export const ArchTechScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Architecture phase: 0 - 4.5s
  const archPhase = frame < fps * 4.5;
  const archOpacity = archPhase
    ? 1
    : interpolate(frame, [fps * 4.5, fps * 5], [1, 0], {
        extrapolateRight: "clamp",
        extrapolateLeft: "clamp",
      });

  // Tech stack phase: 4.5s - 8s
  const techOpacity = interpolate(frame, [fps * 5, fps * 5.5], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div style={fullScreen}>
      {/* Architecture */}
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: archOpacity,
        }}
      >
        <p
          style={{
            fontSize: 20,
            color: colors.red,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            position: "absolute",
            top: 80,
          }}
        >
          Architecture
        </p>

        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
          {[
            [archBoxes[0], archBoxes[1]],
            [archBoxes[0], archBoxes[2]],
          ].map(([from, to], i) => {
            const lineOpacity = interpolate(
              frame,
              [fps * 1.5 + i * fps * 0.3, fps * 2 + i * fps * 0.3],
              [0, 0.3],
              { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
            );
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y + 40}
                x2={to.x}
                y2={to.y - 40}
                stroke={colors.grayDark}
                strokeWidth={2}
                strokeDasharray="8 4"
                opacity={lineOpacity}
              />
            );
          })}
        </svg>

        {archBoxes.map((box, i) => {
          const delay = fps * 0.4 + i * fps * 0.35;
          const boxScale = spring({
            frame: frame - delay,
            fps,
            config: { damping: 12 },
          });
          const boxOpacity = interpolate(frame, [delay, delay + fps * 0.3], [0, 1], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          });
          return (
            <div
              key={box.label}
              style={{
                position: "absolute",
                left: box.x - 130,
                top: box.y - 35,
                width: 260,
                padding: "16px 20px",
                background: colors.bgCard,
                border: `2px solid ${box.color}44`,
                borderRadius: 14,
                opacity: boxOpacity,
                transform: `scale(${Math.max(0, boxScale)})`,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, color: box.color, marginBottom: 4 }}>
                {box.label}
              </div>
              <div style={{ fontSize: 13, color: colors.gray }}>{box.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Tech Stack */}
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: techOpacity,
        }}
      >
        <p
          style={{
            fontSize: 20,
            color: colors.red,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 40,
          }}
        >
          Tech Stack
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "center",
            maxWidth: 700,
          }}
        >
          {techs.map((tech, i) => {
            const delay = fps * 5.3 + i * fps * 0.12;
            const scale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 15 },
            });
            return (
              <div
                key={tech.name}
                style={{
                  background: colors.bgCard,
                  border: `1px solid ${colors.grayDarker}`,
                  borderLeft: `3px solid ${tech.color}`,
                  borderRadius: 10,
                  padding: "14px 24px",
                  transform: `scale(${Math.max(0, scale)})`,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
                  {tech.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
