import { CSSProperties } from "react";

export const colors = {
  bg: "#0a0a0a",
  bgCard: "#141414",
  red: "#dc2626",
  redDark: "#991b1b",
  redLight: "#ef4444",
  gold: "#f59e0b",
  white: "#ffffff",
  gray: "#a1a1aa",
  grayDark: "#3f3f46",
  grayDarker: "#27272a",
};

export const fullScreen: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: colors.bg,
  fontFamily: "'Inter', sans-serif",
  color: colors.white,
  overflow: "hidden",
};

export const heading: CSSProperties = {
  fontSize: 72,
  fontWeight: 800,
  lineHeight: 1.1,
  textAlign: "center",
};

export const subheading: CSSProperties = {
  fontSize: 36,
  fontWeight: 400,
  color: colors.gray,
  textAlign: "center",
  lineHeight: 1.4,
};

export const label: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: colors.gray,
  textTransform: "uppercase",
  letterSpacing: 4,
};
