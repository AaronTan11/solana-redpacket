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
  { component: TitleScene, duration: 150 },            // 5s
  { component: ProblemSolutionScene, duration: 300 },  // 10s
  { component: BrowserCreateScene, duration: 360 },    // 12s
  { component: BrowserClaimScene, duration: 360 },     // 12s
  { component: BlinksScene, duration: 210 },           // 7s
  { component: ArchTechScene, duration: 240 },         // 8s
  { component: SponsorsOutroScene, duration: 210 },    // 7s
];

import { Audio } from "remotion";

// Voiceover start times account for 15-frame transition overlaps:
// Scene 1: 0, Scene 2: 135, Scene 3: 420, Scene 4: 765,
// Scene 5: 1110, Scene 6: 1305, Scene 7: 1530
const voiceovers = [
  { file: "vo-1.mp3", start: 0 },
  { file: "vo-2.mp3", start: 135 },
  { file: "vo-3.mp3", start: 420 },
  { file: "vo-4.mp3", start: 765 },
  { file: "vo-5.mp3", start: 1110 },
  { file: "vo-6.mp3", start: 1305 },
  { file: "vo-7.mp3", start: 1530 },
];

export const DemoVideo = () => {
  return (
    <>
      <Audio src={staticFile("bgm.mp3")} loop volume={0.12} />

      {voiceovers.map((vo) => (
        <Sequence key={vo.file} from={vo.start} layout="none">
          <Audio src={staticFile(vo.file)} volume={0.85} />
        </Sequence>
      ))}

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
