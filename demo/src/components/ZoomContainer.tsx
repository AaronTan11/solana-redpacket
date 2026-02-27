import { ReactNode } from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

export const ZoomContainer = ({
  children,
  zoomTo = 1.4,
  originX = "50%",
  originY = "50%",
  startFrame,
  holdDuration = 60,
  transitionDuration = 20,
}: {
  children: ReactNode;
  zoomTo?: number;
  originX?: string;
  originY?: string;
  startFrame: number;
  holdDuration?: number;
  transitionDuration?: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const zoomEndFrame = startFrame + transitionDuration;
  const holdEndFrame = zoomEndFrame + holdDuration;
  const zoomOutEndFrame = holdEndFrame + transitionDuration;

  let scale = 1;

  if (frame >= startFrame && frame < zoomEndFrame) {
    // Zoom in
    const progress = spring({
      frame: frame - startFrame,
      fps,
      durationInFrames: transitionDuration,
      config: { damping: 20 },
    });
    scale = interpolate(progress, [0, 1], [1, zoomTo]);
  } else if (frame >= zoomEndFrame && frame < holdEndFrame) {
    // Hold
    scale = zoomTo;
  } else if (frame >= holdEndFrame && frame < zoomOutEndFrame) {
    // Zoom out
    const progress = spring({
      frame: frame - holdEndFrame,
      fps,
      durationInFrames: transitionDuration,
      config: { damping: 20 },
    });
    scale = interpolate(progress, [0, 1], [zoomTo, 1]);
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: `scale(${scale})`,
        transformOrigin: `${originX} ${originY}`,
      }}
    >
      {children}
    </div>
  );
};
