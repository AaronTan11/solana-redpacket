import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { colors, fullScreen } from "../styles";

export const ProblemSolutionScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Problem text: 0 - 1.5s
  const problemOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });
  const problemY = interpolate(frame, [0, fps * 0.3], [30, 0], {
    extrapolateRight: "clamp",
  });

  // Transition: problem fades, solution appears at ~2s
  const problemFade = interpolate(
    frame,
    [fps * 1.5, fps * 2],
    [1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );
  const solutionOpacity = interpolate(
    frame,
    [fps * 2, fps * 2.5],
    [0, 1],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );
  const solutionY = interpolate(
    frame,
    [fps * 2, fps * 2.5],
    [30, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );

  return (
    <div style={fullScreen}>
      {/* Problem */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: problemOpacity * problemFade,
          transform: `translateY(${problemY}px)`,
        }}
      >
        <p
          style={{
            fontSize: 20,
            color: colors.red,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          The Problem
        </p>
        <h2
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: colors.white,
            margin: 0,
            textAlign: "center",
            maxWidth: 800,
            lineHeight: 1.2,
          }}
        >
          Sending crypto to groups is clunky
        </h2>
      </div>

      {/* Solution */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: solutionOpacity,
          transform: `translateY(${solutionY}px)`,
        }}
      >
        <p
          style={{
            fontSize: 20,
            color: colors.gold,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          The Solution
        </p>
        <h2
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: colors.white,
            margin: 0,
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.2,
          }}
        >
          <span style={{ color: colors.red }}>Red Packets</span> — one link,
          multiple recipients
        </h2>
      </div>
    </div>
  );
};
