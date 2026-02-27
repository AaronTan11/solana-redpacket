import { Sequence, staticFile, useVideoConfig } from "remotion";
import {
  TransitionSeries,
  linearTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

import { TitleScene } from "./scenes/TitleScene";
import { ProblemSolutionScene } from "./scenes/ProblemSolutionScene";
import { BrowserCreateScene } from "./scenes/BrowserCreateScene";
import { BrowserClaimScene } from "./scenes/BrowserClaimScene";
import { BlinksScene } from "./scenes/BlinksScene";
import { ArchTechScene } from "./scenes/ArchTechScene";
import { SponsorsOutroScene } from "./scenes/SponsorsOutroScene";

const TRANSITION = 15;

const scenes = [
  { component: TitleScene, duration: 75 },            // 2.5s
  { component: ProblemSolutionScene, duration: 120 },  // 4s
  { component: BrowserCreateScene, duration: 360 },    // 12s
  { component: BrowserClaimScene, duration: 360 },     // 12s
  { component: BlinksScene, duration: 180 },           // 6s
  { component: ArchTechScene, duration: 240 },         // 8s
  { component: SponsorsOutroScene, duration: 150 },    // 5s
];

// Audio integration — uncomment when audio files are in demo/public/
// import { Audio } from "@remotion/media";

const voiceovers = [
  { file: "vo-1.mp3", start: 0 },
  { file: "vo-2.mp3", start: 75 },
  { file: "vo-3.mp3", start: 195 },
  { file: "vo-4.mp3", start: 555 },
  { file: "vo-5.mp3", start: 915 },
  { file: "vo-6.mp3", start: 1095 },
  { file: "vo-7.mp3", start: 1335 },
];

export const DemoVideo = () => {
  return (
    <>
      {/* Background music — uncomment when bgm.mp3 is in demo/public/
      <Audio src={staticFile("bgm.mp3")} loop volume={0.12} />
      */}

      {/* Voiceovers — uncomment when vo-*.mp3 files are in demo/public/
      {voiceovers.map((vo) => (
        <Sequence key={vo.file} from={vo.start} layout="none">
          <Audio src={staticFile(vo.file)} volume={0.85} />
        </Sequence>
      ))}
      */}

      <TransitionSeries>
        {scenes.map((scene, i) => {
          const Scene = scene.component;
          const isLast = i === scenes.length - 1;

          return [
            <TransitionSeries.Sequence
              key={`scene-${i}`}
              durationInFrames={scene.duration}
            >
              <Scene />
            </TransitionSeries.Sequence>,
            !isLast && (
              <TransitionSeries.Transition
                key={`transition-${i}`}
                presentation={i % 2 === 0 ? fade() : slide({ direction: "from-right" })}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />
            ),
          ];
        })}
      </TransitionSeries>
    </>
  );
};
