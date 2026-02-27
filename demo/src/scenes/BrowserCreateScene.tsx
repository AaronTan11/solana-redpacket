import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { Sequence } from "remotion";
import { BrowserFrame } from "../components/BrowserFrame";
import { Cursor } from "../components/Cursor";
import { ClickEffects } from "../components/ClickEffect";
import { ZoomContainer } from "../components/ZoomContainer";
import { colors } from "../styles";

// Mock form matching the real shadcn/ui create page
const MockCreateForm = ({ frame, fps }: { frame: number; fps: number }) => {
  const showSolActive = frame > fps * 1.5;
  const showAmount = frame > fps * 2.5;
  const amountText = showAmount
    ? "0.5".slice(0, Math.min(3, Math.floor((frame - fps * 2.5) / 4)))
    : "";
  const showRecipients = frame > fps * 4;
  const recipientVal = showRecipients
    ? Math.min(5, 1 + Math.floor((frame - fps * 4) / 8))
    : 3;
  const showRandom = frame > fps * 5.5;
  const showButton = frame > fps * 7;
  const buttonClicked = frame > fps * 8;

  // Success state after button click
  const showSuccess = frame > fps * 9;
  const successOpacity = showSuccess
    ? interpolate(frame, [fps * 9, fps * 9.5], [0, 1], {
        extrapolateRight: "clamp",
        extrapolateLeft: "clamp",
      })
    : 0;

  if (showSuccess) {
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
        {/* Nav bar */}
        <NavBar />
        <DevnetBanner />
        <div
          style={{
            maxWidth: 600,
            width: "100%",
            padding: "0 24px",
            opacity: successOpacity,
          }}
        >
          <div
            style={{
              background: "#141414",
              border: "1px solid #27272a",
              borderRadius: 12,
              padding: 28,
              marginTop: 24,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              Share This Link
            </div>
            <div style={{ fontSize: 13, color: "#71717a", marginBottom: 16 }}>
              Recipients can claim by visiting this URL
            </div>
            <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 6, fontWeight: 600 }}>
              Website Link
            </div>
            <code
              style={{
                display: "block",
                background: "#1a1a1a",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "#a1a1aa",
                wordBreak: "break-all",
                marginBottom: 12,
              }}
            >
              redpackets.space/claim/7xKd...m3Fv/1740000000
            </code>
            <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 6, fontWeight: 600 }}>
              Blink URL (Solana Actions)
            </div>
            <code
              style={{
                display: "block",
                background: "#1a1a1a",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12,
                color: "#a1a1aa",
                wordBreak: "break-all",
              }}
            >
              blinks.redpackets.space/api/actions/claim?creator=7xKd...&id=1740000000
            </code>
          </div>
        </div>
      </div>
    );
  }

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
      <NavBar />
      <DevnetBanner />
      <div style={{ maxWidth: 600, width: "100%", padding: "0 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
          Create Red Packet
        </h1>
        <p style={{ fontSize: 14, color: "#71717a", marginBottom: 20 }}>
          Send SOL or SPL tokens to multiple recipients
        </p>

        {/* Card */}
        <div
          style={{
            background: "#141414",
            border: "1px solid #27272a",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 16 }}>
            New Red Packet
          </div>

          {/* Token Type */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#a1a1aa", marginBottom: 6 }}>
              Token Type
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  background: showSolActive ? colors.red : "transparent",
                  color: showSolActive ? "#fff" : "#71717a",
                  border: showSolActive ? "none" : "1px solid #3f3f46",
                }}
              >
                SOL
              </div>
              <div
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  background: "transparent",
                  color: "#71717a",
                  border: "1px solid #3f3f46",
                }}
              >
                SPL Token
              </div>
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#a1a1aa", marginBottom: 6 }}>
              Total Amount (SOL)
            </div>
            <div
              style={{
                background: "#1a1a1a",
                border: "1px solid #3f3f46",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 14,
                color: amountText ? "#fff" : "#555",
              }}
            >
              {amountText || "0.0"}
            </div>
          </div>

          {/* Recipients */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#a1a1aa", marginBottom: 6 }}>
              Recipients: {recipientVal}
            </div>
            <div
              style={{
                height: 6,
                background: "#27272a",
                borderRadius: 3,
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${(recipientVal / 20) * 100}%`,
                  height: "100%",
                  background: colors.red,
                  borderRadius: 3,
                }}
              />
            </div>
          </div>

          {/* Split Mode */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#a1a1aa", marginBottom: 6 }}>
              Split Mode
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  background: showRandom ? "transparent" : colors.red,
                  color: showRandom ? "#71717a" : "#fff",
                  border: showRandom ? "1px solid #3f3f46" : "none",
                }}
              >
                Even
              </div>
              <div
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  background: showRandom ? colors.red : "transparent",
                  color: showRandom ? "#fff" : "#71717a",
                  border: showRandom ? "none" : "1px solid #3f3f46",
                }}
              >
                Random
              </div>
            </div>
          </div>

          {/* Create Button */}
          <div
            style={{
              background: showButton
                ? buttonClicked
                  ? "#7f1d1d"
                  : colors.red
                : "#27272a",
              borderRadius: 8,
              padding: "10px 0",
              textAlign: "center",
              fontSize: 14,
              fontWeight: 600,
              color: showButton ? "#fff" : "#555",
              marginTop: 8,
            }}
          >
            {buttonClicked ? "Creating..." : "Create Red Packet"}
          </div>
        </div>
      </div>
    </div>
  );
};

const DevnetBanner = () => (
  <div
    style={{
      width: "100%",
      background: "rgba(120, 53, 15, 0.5)",
      borderBottom: "1px solid rgba(180, 83, 9, 0.3)",
      padding: "5px 0",
      textAlign: "center",
      fontSize: 11,
      color: "#fbbf24",
    }}
  >
    Devnet only — this app uses Solana devnet tokens with no real value
  </div>
);

const NavBar = () => (
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
        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
          Create
        </span>
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
      7xKd...m3Fv
    </div>
  </div>
);

export const BrowserCreateScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Cursor keypoints (x, y relative to browser content area: 1720x864)
  // Form is maxWidth 600, centered → x range 560-1160, center x=860
  // Card starts at roughly y=205, buttons/fields inside at offsets below
  const cursorPoints = [
    { x: 700, y: 200, frame: 0 },             // Start in view
    { x: 612, y: 299, frame: fps * 1.2 },     // SOL button (left side of card)
    { x: 860, y: 368, frame: fps * 2.2 },     // Amount field (center)
    { x: 750, y: 425, frame: fps * 3.8 },     // Recipient slider
    { x: 688, y: 482, frame: fps * 5.2 },     // Random button
    { x: 860, y: 541, frame: fps * 7.5 },     // Create button (full width, center)
    { x: 860, y: 541, frame: fps * 8 },       // Stay on button
    { x: 860, y: 350, frame: fps * 9.5 },     // Move to success area
  ];

  const clickFrames = [
    { x: 612, y: 299, frame: Math.round(fps * 1.5) },   // Click SOL
    { x: 860, y: 368, frame: Math.round(fps * 2.5) },   // Click amount field
    { x: 688, y: 482, frame: Math.round(fps * 5.5) },   // Click Random
    { x: 860, y: 541, frame: Math.round(fps * 8) },     // Click Create
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
      }}
    >
      <ZoomContainer
        startFrame={Math.round(fps * 7)}
        holdDuration={Math.round(fps * 2)}
        zoomTo={1.3}
        originY="70%"
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
          <BrowserFrame url="redpackets.space">
            <MockCreateForm frame={frame} fps={fps} />
            <Cursor points={cursorPoints} />
            <ClickEffects clicks={clickFrames} />
          </BrowserFrame>
        </div>
      </ZoomContainer>
    </div>
  );
};
