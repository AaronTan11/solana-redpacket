import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors, fullScreen } from "../styles";

export const SponsorsOutroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Sponsors: 0 - 2.5s
  const sponsorsOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });
  const sponsorsFade = interpolate(frame, [fps * 2.2, fps * 2.5], [1, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // Outro: 2.5s - 5s
  const outroOpacity = interpolate(frame, [fps * 2.5, fps * 3], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const outroScale = spring({
    frame: Math.max(0, frame - fps * 2.5),
    fps,
    config: { damping: 12 },
  });

  const links = [
    { label: "Live Demo", value: "solana-redpacket.vercel.app" },
    { label: "Blinks", value: "46.62.206.161" },
    { label: "Program", value: "CeAkHjh...bc6Gz" },
  ];

  return (
    <div style={fullScreen}>
      {/* Sponsors */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: sponsorsOpacity * sponsorsFade,
        }}
      >
        <p
          style={{
            fontSize: 18,
            color: colors.gray,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 36,
          }}
        >
          Built For
        </p>
        <div style={{ display: "flex", gap: 48 }}>
          {[
            { name: "Solana Foundation", desc: "Main Track", color: "#9945FF" },
            { name: "Orbitflare", desc: "Blinks Bounty", color: colors.gold },
          ].map((s, i) => {
            const delay = fps * 0.3 + i * fps * 0.3;
            const scale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 12 },
            });
            return (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  transform: `scale(${Math.max(0, scale)})`,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: `${s.color}22`,
                    border: `2px solid ${s.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 28,
                    color: s.color,
                    fontWeight: 900,
                    marginBottom: 12,
                  }}
                >
                  {s.name[0]}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 14, color: colors.gray }}>{s.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Outro */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: outroOpacity,
          transform: `scale(${outroScale})`,
        }}
      >
        {/* Red glow */}
        <div
          style={{
            position: "absolute",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${colors.red}33 0%, transparent 70%)`,
            filter: "blur(80px)",
          }}
        />
        <div style={{ fontSize: 64, marginBottom: 8, position: "relative" }}>🧧</div>
        <h1
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: colors.red,
            margin: 0,
            marginBottom: 8,
            position: "relative",
          }}
        >
          Red Packet
        </h1>
        <p
          style={{
            fontSize: 22,
            color: colors.gray,
            marginBottom: 32,
            position: "relative",
          }}
        >
          Try it now
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
            position: "relative",
          }}
        >
          {links.map((link) => (
            <div key={link.label} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span
                style={{ fontSize: 12, color: colors.grayDark, fontWeight: 600, width: 70, textAlign: "right" }}
              >
                {link.label}
              </span>
              <code
                style={{
                  fontSize: 14,
                  color: colors.gray,
                  background: colors.grayDarker,
                  padding: "4px 12px",
                  borderRadius: 6,
                }}
              >
                {link.value}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
