import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors, fullScreen } from "../styles";

export const TitleScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 12 } });
  const titleOpacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [fps * 0.8, fps * 1.5], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const taglineY = interpolate(frame, [fps * 0.8, fps * 1.5], [30, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div style={fullScreen}>
      {/* Red glow background */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colors.red}33 0%, transparent 70%)`,
          filter: "blur(80px)",
          opacity: interpolate(frame, [0, fps], [0, 0.6], {
            extrapolateRight: "clamp",
          }),
        }}
      />

      {/* Envelope emoji */}
      <div
        style={{
          fontSize: 120,
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          marginBottom: 20,
        }}
      >
        🧧
      </div>

      {/* Title */}
      <h1
        style={{
          fontSize: 96,
          fontWeight: 900,
          color: colors.red,
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          margin: 0,
          letterSpacing: -2,
        }}
      >
        Red Packet
      </h1>

      {/* Tagline */}
      <p
        style={{
          fontSize: 32,
          color: colors.gray,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          marginTop: 16,
        }}
      >
        On-chain red packets for Solana
      </p>
    </div>
  );
};
