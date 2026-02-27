import { ReactNode } from "react";

const TITLE_BAR_HEIGHT = 40;
const ADDR_BAR_HEIGHT = 36;
const CHROME_HEIGHT = TITLE_BAR_HEIGHT + ADDR_BAR_HEIGHT;

export const BrowserFrame = ({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) => {
  return (
    <div
      style={{
        width: 1720,
        height: 940,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
        border: "1px solid #333",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          height: TITLE_BAR_HEIGHT,
          background: "#1e1e1e",
          display: "flex",
          alignItems: "center",
          paddingLeft: 16,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#ff5f57",
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#febc2e",
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#28c840",
          }}
        />
        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 13,
            color: "#999",
            fontWeight: 500,
            marginRight: 52,
          }}
        >
          Red Packet
        </div>
      </div>

      {/* Address bar */}
      <div
        style={{
          height: ADDR_BAR_HEIGHT,
          background: "#1e1e1e",
          display: "flex",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 16,
          borderBottom: "1px solid #333",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            marginRight: 12,
          }}
        >
          {/* Nav arrows */}
          <span style={{ fontSize: 14, color: "#555" }}>←</span>
          <span style={{ fontSize: 14, color: "#555" }}>→</span>
        </div>
        <div
          style={{
            flex: 1,
            background: "#2a2a2a",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 13,
            color: "#aaa",
            fontFamily: "monospace",
          }}
        >
          🔒 {url}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          background: "#0a0a0a",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export { CHROME_HEIGHT };
