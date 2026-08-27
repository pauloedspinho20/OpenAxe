/**
 * Remotion config — no Tailwind, no Node API overrides.
 * See https://www.remotion.dev/docs/config
 */
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
Config.setChromiumOpenGlRenderer('angle')
