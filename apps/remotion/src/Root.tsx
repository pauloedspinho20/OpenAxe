import { Composition } from 'remotion'
import { z } from 'zod'
import { Hero, heroSchema } from './compositions/Hero'
import { Amp, ampSchema } from './compositions/Amp'
import { Effects, effectsSchema } from './compositions/Effects'
import { CabMixer, cabMixerSchema } from './compositions/CabMixer'
import { Platforms, platformsSchema } from './compositions/Platforms'

// 720p, 30fps, 10s = 300 frames — silent loops, h264
const FPS = 30
const W = 1280
const H = 720
const DUR = 10 * FPS // 8-12s spec — 10s is the sweet spot for loops

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Hero"
        component={Hero as React.FC<z.infer<typeof heroSchema>>}
        schema={heroSchema}
        defaultProps={{ theme: 'carbon' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="HeroAluminum"
        component={Hero as React.FC<z.infer<typeof heroSchema>>}
        schema={heroSchema}
        defaultProps={{ theme: 'aluminum' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="Amp"
        component={Amp as React.FC<z.infer<typeof ampSchema>>}
        schema={ampSchema}
        defaultProps={{ theme: 'carbon' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="AmpAluminum"
        component={Amp as React.FC<z.infer<typeof ampSchema>>}
        schema={ampSchema}
        defaultProps={{ theme: 'aluminum' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="Effects"
        component={Effects as React.FC<z.infer<typeof effectsSchema>>}
        schema={effectsSchema}
        defaultProps={{ theme: 'carbon' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="EffectsAluminum"
        component={Effects as React.FC<z.infer<typeof effectsSchema>>}
        schema={effectsSchema}
        defaultProps={{ theme: 'aluminum' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="CabMixer"
        component={CabMixer as React.FC<z.infer<typeof cabMixerSchema>>}
        schema={cabMixerSchema}
        defaultProps={{ theme: 'carbon' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="CabMixerAluminum"
        component={CabMixer as React.FC<z.infer<typeof cabMixerSchema>>}
        schema={cabMixerSchema}
        defaultProps={{ theme: 'aluminum' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="Platforms"
        component={Platforms as React.FC<z.infer<typeof platformsSchema>>}
        schema={platformsSchema}
        defaultProps={{ theme: 'carbon' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="PlatformsAluminum"
        component={Platforms as React.FC<z.infer<typeof platformsSchema>>}
        schema={platformsSchema}
        defaultProps={{ theme: 'aluminum' }}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => ({
          props: props as never,
          durationInFrames: DUR,
          fps: FPS,
          width: W,
          height: H,
        })}
        durationInFrames={DUR}
        fps={FPS}
        width={W}
        height={H}
      />
    </>
  )
}
