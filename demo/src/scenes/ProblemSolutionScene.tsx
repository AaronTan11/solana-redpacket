import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { colors, fullScreen } from "../styles";

export const ProblemSolutionScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Problem text: 0 - 5s
  const problemOpacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });
  const problemY = interpolate(frame, [0, fps * 0.5], [30, 0], {
    extrapolateRight: "clamp",
  });

  // Transition: problem fades at ~4.5s, solution appears at ~5s
  const problemFade = interpolate(
    frame,
    [fps * 4.5, fps * 5],
    [1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );
  const solutionOpacity = interpolate(
    frame,
    [fps * 5, fps * 5.5],
    [0, 1],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" }
  );
  const solutionY = interpolate(
    frame,
    [fps * 5, fps * 5.5],
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
            maxWidth: 900,
            lineHeight: 1.2,
          }}
        >
          Sending crypto to groups?
          <br />
          <span style={{ fontSize: 36, color: colors.gray }}>Multiple transfers, manual splitting.</span>
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
          There's a <span style={{ color: colors.red }}>better way</span>
        </h2>
      </div>
    </div>
  );
};
