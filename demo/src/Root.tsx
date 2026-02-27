import { Composition } from "remotion";
import { DemoVideo } from "./DemoVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="DemoVideo"
      component={DemoVideo}
      durationInFrames={1740}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
