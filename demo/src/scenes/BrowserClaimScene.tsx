import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { BrowserFrame } from "../components/BrowserFrame";
import { Cursor } from "../components/Cursor";
import { ClickEffects } from "../components/ClickEffect";
import { colors } from "../styles";

const slots = [
  { amount: "0.15 SOL", claimed: true, claimer: "3nP..v2D" },
  { amount: "0.08 SOL", claimed: true, claimer: "9mQ..k7R" },
  { amount: "0.12 SOL", claimed: false, claimer: "" },
  { amount: "0.05 SOL", claimed: false, claimer: "" },
  { amount: "0.10 SOL", claimed: false, claimer: "" },
];

const MockClaimPage = ({ frame, fps }: { frame: number; fps: number }) => {
  const claimClicked = frame > fps * 7;
  const slotFilled = frame > fps * 7.5;
  const claimCount = slotFilled ? 3 : 2;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 0",
      }}
    >
      {/* Nav */}
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 24px",
          marginBottom: 24,
          borderBottom: "1px solid #27272a",
          paddingBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: colors.red }}>
            Red Packet
          </span>
          <div style={{ display: "flex", gap: 16 }}>
            <span style={{ fontSize: 13, color: "#71717a" }}>Create</span>
            <span style={{ fontSize: 13, color: "#71717a" }}>Dashboard</span>
          </div>
        </div>
        <div
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #3f3f46",
            fontSize: 12,
            color: "#a1a1aa",
          }}
        >
          Bx9p...w4Tz
        </div>
      </div>

      <div style={{ maxWidth: 600, width: "100%", padding: "0 24px" }}>
        {/* Claim card */}
        <div
          style={{
            background: "#141414",
            border: "1px solid #27272a",
            borderRadius: 12,
            padding: 24,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              🧧 Red Packet
            </div>
            <span
              style={{
                fontSize: 12,
                color: "#22c55e",
                background: "rgba(34,197,94,0.1)",
                padding: "3px 10px",
                borderRadius: 20,
                fontWeight: 600,
              }}
            >
              Active
            </span>
          </div>

          {/* Amount */}
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 4,
            }}
          >
            0.50 SOL
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#71717a",
              marginBottom: 20,
            }}
          >
            {claimCount}/5 claimed · Random split · Expires in 23h
          </div>

          {/* Slots */}
          {slots.map((slot, i) => {
            const isFilling = i === 2 && slotFilled;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  marginBottom: 4,
                  borderRadius: 6,
                  background:
                    slot.claimed || isFilling
                      ? "rgba(220,38,38,0.06)"
                      : "rgba(39,39,42,0.4)",
                }}
              >
                <span style={{ fontSize: 13, color: "#71717a" }}>
                  Slot {i + 1}
                  {(slot.claimed || isFilling) && (
                    <span style={{ color: "#3f3f46", marginLeft: 8, fontSize: 11 }}>
                      {isFilling ? "Bx9p..w4Tz" : slot.claimer}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: slot.claimed || isFilling ? "#3f3f46" : "#fff",
                  }}
                >
                  {slot.amount} {slot.claimed || isFilling ? "✓" : ""}
                </span>
              </div>
            );
          })}

          {/* Claim button */}
          <div
            style={{
              marginTop: 16,
              background: claimClicked ? "#166534" : colors.red,
              borderRadius: 8,
              padding: "10px 0",
              textAlign: "center",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
            }}
          >
            {claimClicked ? "Claimed 0.12 SOL ✓" : "Claim Your Share"}
          </div>
        </div>
      </div>
    </div>
  );
};

export const BrowserClaimScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardOpacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const cursorPoints = [
    { x: 600, y: 200, frame: 0 },
    { x: 400, y: 350, frame: fps * 2 },     // Browse slots
    { x: 400, y: 450, frame: fps * 4 },     // Scroll down
    { x: 400, y: 530, frame: fps * 6 },     // Claim button
    { x: 400, y: 530, frame: fps * 7 },     // Stay on button
    { x: 400, y: 350, frame: fps * 9 },     // Move up after claim
  ];

  const clickFrames = [
    { x: 400, y: 530, frame: Math.round(fps * 7) },
  ];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: cardOpacity,
      }}
    >
      <BrowserFrame url="solana-redpacket.vercel.app/claim/7xKd...m3Fv/1740000000">
        <MockClaimPage frame={frame} fps={fps} />
        <Cursor points={cursorPoints} />
        <ClickEffects clicks={clickFrames} />
      </BrowserFrame>
    </div>
  );
};
