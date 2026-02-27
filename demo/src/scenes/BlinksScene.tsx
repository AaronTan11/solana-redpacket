import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors, fullScreen } from "../styles";

const RedPacketIcon = () => (
  <svg viewBox="0 0 512 512" width="100%" height="100%">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#b91c1c" />
      </linearGradient>
      <linearGradient id="flap" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#dc2626" />
        <stop offset="100%" stopColor="#991b1b" />
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <rect x="80" y="100" width="352" height="360" rx="24" fill="url(#bg)" />
    <path d="M80 100 L256 220 L432 100 L432 124 L256 244 L80 124 Z" fill="url(#flap)" />
    <circle cx="256" cy="310" r="72" fill="url(#gold)" opacity="0.95" />
    <text x="256" y="330" textAnchor="middle" fontSize="80" fontWeight="bold" fill="#b91c1c" fontFamily="serif">
      &#31119;
    </text>
    <rect x="100" y="160" width="312" height="2" rx="1" fill="#fbbf24" opacity="0.3" />
    <rect x="100" y="420" width="312" height="2" rx="1" fill="#fbbf24" opacity="0.3" />
  </svg>
);

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

  const urlOpacity = interpolate(frame, [fps * 3, fps * 3.5], [0, 1], {
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

      {/* Blink card matching dial.to */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 480,
          overflow: "hidden",
          opacity: cardOpacity,
          transform: `scale(${Math.max(0, cardScale)})`,
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          border: "1px solid #e5e5e5",
        }}
      >
        {/* Icon area */}
        <div
          style={{
            background: "#f5f5f5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 0",
          }}
        >
          <div style={{ width: 200, height: 200 }}>
            <RedPacketIcon />
          </div>
        </div>

        {/* Card body */}
        <div style={{ padding: "16px 24px 24px" }}>
          {/* Domain */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 13, color: "#737373" }}>
              blinks.redpackets.space
            </span>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#f59e0b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                color: "#fff",
                fontWeight: 700,
              }}
            >
              !
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#171717",
              marginBottom: 4,
            }}
          >
            Red Packet
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 14,
              color: "#525252",
              marginBottom: 16,
            }}
          >
            0.50 SOL red packet — 0/5 claimed, 0.50 SOL remaining
          </div>

          {/* Claim button */}
          <div
            style={{
              background: "#171717",
              borderRadius: 12,
              padding: "14px 0",
              textAlign: "center",
              fontSize: 16,
              fontWeight: 600,
              color: "#fff",
            }}
          >
            Claim (Random Amount)
          </div>

          {/* Powered by */}
          <div
            style={{
              textAlign: "center",
              marginTop: 12,
              fontSize: 12,
              color: "#a3a3a3",
            }}
          >
            powered by Dialect
          </div>
        </div>
      </div>

      {/* URL below */}
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
          dial.to/?action=solana-action:blinks.redpackets.space/api/actions/claim?...
        </code>
      </div>
    </div>
  );
};
