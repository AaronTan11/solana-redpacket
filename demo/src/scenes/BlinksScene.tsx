import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors, fullScreen } from "../styles";

export const BlinksScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  const cardScale = spring({
    frame: frame - fps * 0.5,
    fps,
    config: { damping: 15 },
  });
  const cardOpacity = interpolate(frame, [fps * 0.5, fps * 0.8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const urlOpacity = interpolate(frame, [fps * 1.8, fps * 2.2], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div style={fullScreen}>
      <p
        style={{
          fontSize: 24,
          color: colors.gold,
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: headerOpacity,
          marginBottom: 12,
        }}
      >
        Solana Blinks
      </p>
      <h2
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: colors.white,
          opacity: headerOpacity,
          margin: 0,
          marginBottom: 40,
          textAlign: "center",
        }}
      >
        Share as a <span style={{ color: colors.red }}>Blink</span>
      </h2>

      {/* Mock blink card */}
      <div
        style={{
          background: colors.bgCard,
          border: `1px solid ${colors.grayDarker}`,
          borderRadius: 16,
          width: 480,
          overflow: "hidden",
          opacity: cardOpacity,
          transform: `scale(${Math.max(0, cardScale)})`,
        }}
      >
        {/* Blink header */}
        <div
          style={{
            background: `linear-gradient(135deg, ${colors.redDark}, ${colors.red})`,
            padding: "32px 28px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 48 }}>🧧</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.white }}>
              Red Packet
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
              0.50 SOL · 3 slots remaining
            </div>
          </div>
        </div>

        {/* Blink body */}
        <div style={{ padding: "20px 28px" }}>
          <p style={{ fontSize: 16, color: colors.gray, margin: "0 0 20px" }}>
            Claim your share of this red packet! Connect your wallet and hit
            claim.
          </p>
          <div
            style={{
              background: colors.red,
              borderRadius: 10,
              padding: "12px 0",
              textAlign: "center",
              fontSize: 16,
              fontWeight: 700,
              color: colors.white,
            }}
          >
            Claim SOL
          </div>
        </div>
      </div>

      {/* URL */}
      <div
        style={{
          marginTop: 32,
          opacity: urlOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <p style={{ fontSize: 14, color: colors.grayDark, margin: 0 }}>
          Shareable on any Actions-compatible platform
        </p>
        <code
          style={{
            fontSize: 14,
            color: colors.gray,
            background: colors.grayDarker,
            padding: "8px 16px",
            borderRadius: 8,
          }}
        >
          /api/actions/claim?creator=7xKd...&id=123
        </code>
      </div>
    </div>
  );
};
