export type VendorCategory = 'dsp' | 'desktop' | 'plugin' | 'web' | 'service'

export interface VendorCategoryMeta {
  key: VendorCategory
  label: string
}

export interface VendorEntry {
  name: string
  category: VendorCategory
  version: string
  license: string
  usedFor: string
  icon?: string
  brandImg?: string
  officialUrl?: string
  repoUrl: string
  repoLabel?: string
  featured?: boolean
}

export const CATEGORY_META: readonly VendorCategoryMeta[] = [
  { key: 'dsp', label: 'C++20 DSP Core' },
  { key: 'desktop', label: 'Desktop Shell' },
  { key: 'plugin', label: 'DAW Plugins' },
  { key: 'web', label: 'Web & Toolchain' },
  { key: 'service', label: 'Ecosystem' },
]

export const VENDORS: readonly VendorEntry[] = [
  {
    name: 'NeuralAmpModelerCore',
    category: 'dsp',
    version: '0.5.5 · daae2d0',
    license: 'MIT',
    usedFor:
      'Core neural amp, pedal, and full-rig .nam model loader and real-time inference engine.',
    brandImg: '/brands/nam.png',
    officialUrl: 'https://www.neuralampmodeler.com/',
    repoUrl: 'https://github.com/sdatkinson/NeuralAmpModelerCore',
    featured: true,
  },
  {
    name: 'AudioDSPTools',
    category: 'dsp',
    version: '0827c6c',
    license: 'MIT',
    usedFor:
      'Real-time audio DSP utilities and signal-processing primitives compiled with NAMCore.',
    icon: 'cplusplus',
    repoUrl: 'https://github.com/sdatkinson/AudioDSPTools',
  },
  {
    name: 'Eigen',
    category: 'dsp',
    version: '5.0.1',
    license: 'MPL-2.0',
    usedFor:
      'Header-only SIMD linear algebra and matrix math accelerating neural network inference inside NAMCore.',
    icon: 'gitlab',
    officialUrl: 'https://eigen.tuxfamily.org/',
    repoUrl: 'https://gitlab.com/libeigen/eigen',
    repoLabel: 'GitLab',
    featured: true,
  },
  {
    name: 'DSPark',
    category: 'dsp',
    version: '1.6.1 · fad3162',
    license: 'MIT',
    usedFor:
      'Header-only C++20 audio effects powering OpenAxe’s Compressor, Equalizer, Noise Gate, and Tremolo blocks.',
    icon: 'cplusplus',
    repoUrl: 'https://github.com/CristianMoresi/DSPark',
    featured: true,
  },
  {
    name: 'DaisySP',
    category: 'dsp',
    version: '599511b',
    license: 'MIT',
    usedFor:
      'MIT-licensed stereo Chorus DSP module compiled into packages/core (LGPL subtree excluded).',
    icon: 'cplusplus',
    officialUrl: 'https://electro-smith.com/',
    repoUrl: 'https://github.com/electro-smith/DaisySP',
    featured: true,
  },
  {
    name: 'nlohmann/json',
    category: 'dsp',
    version: '3.11.3',
    license: 'MIT',
    usedFor:
      'Header-only JSON parser for .nam model metadata, rig state serialization, and native bridge RPC messages.',
    icon: 'cplusplus',
    officialUrl: 'https://json.nlohmann.me/',
    repoUrl: 'https://github.com/nlohmann/json',
  },
  {
    name: 'miniaudio',
    category: 'desktop',
    version: '0.11.25',
    license: 'MIT-0 / Public Domain',
    usedFor:
      'Single-header low-latency duplex audio I/O across CoreAudio (macOS), WASAPI (Windows), and ALSA/PulseAudio/JACK (Linux).',
    icon: 'cpu',
    officialUrl: 'https://miniaud.io/',
    repoUrl: 'https://github.com/mackron/miniaudio',
    featured: true,
  },
  {
    name: 'webview',
    category: 'desktop',
    version: '0.12.0',
    license: 'MIT',
    usedFor:
      'Lightweight native OS webview host (WKWebView, WebView2, WebKitGTK) embedding the studio UI without Electron.',
    icon: 'layers',
    officialUrl: 'https://webview.dev/',
    repoUrl: 'https://github.com/webview/webview',
    featured: true,
  },
  {
    name: 'portable-file-dialogs',
    category: 'desktop',
    version: '0.1.0',
    license: 'WTFPL',
    usedFor:
      'Native OS file picker dialogs for importing .nam captures, .wav cabinet IRs, and preset bundles.',
    icon: 'layers',
    repoUrl: 'https://github.com/samhocevar/portable-file-dialogs',
  },
  {
    name: 'iPlug2',
    category: 'plugin',
    version: '1527935',
    license: 'zlib-style',
    usedFor:
      'C++ audio plugin framework wrapping packages/core and hosting the shared WebView editor across DAW formats.',
    icon: 'plug',
    officialUrl: 'https://iplug2.github.io/',
    repoUrl: 'https://github.com/iPlug2/iPlug2',
    featured: true,
  },
  {
    name: 'Steinberg VST3 SDK',
    category: 'plugin',
    version: 'via iPlug2',
    license: 'GPL-3.0 (dual)',
    usedFor:
      'Steinberg VST3 plugin ABI, parameter automation, and host lifecycle interfaces (used under the GPLv3 arm).',
    icon: 'plug',
    officialUrl: 'https://www.steinberg.net/developers/',
    repoUrl: 'https://github.com/steinbergmedia/vst3sdk',
  },
  {
    name: 'CLAP SDK',
    category: 'plugin',
    version: 'via iPlug2',
    license: 'MIT',
    usedFor:
      'Clever Audio Plugin open ABI for low-overhead DAW integration and modern parameter modulation.',
    icon: 'plug',
    officialUrl: 'https://cleveraudio.org/',
    repoUrl: 'https://github.com/free-audio/clap',
  },
  {
    name: 'Apple Audio Unit SDK',
    category: 'plugin',
    version: 'macOS SDK',
    license: 'Apple SDK',
    usedFor:
      'Native macOS Audio Unit (.component) plugin target for Logic Pro, GarageBand, and CoreAudio hosts.',
    icon: 'apple',
    officialUrl: 'https://developer.apple.com/documentation/audiotoolbox',
    repoUrl: 'https://github.com/apple/AudioUnitSDK',
  },
  {
    name: 'Emscripten',
    category: 'web',
    version: 'WASM SDK',
    license: 'MIT / NCSA',
    usedFor:
      'Compiles the C++20 packages/core DSP engine to WebAssembly for real-time AudioWorklet processing in browsers.',
    icon: 'webassembly',
    officialUrl: 'https://emscripten.org/',
    repoUrl: 'https://github.com/emscripten-core/emscripten',
    featured: true,
  },
  {
    name: 'React & React DOM',
    category: 'web',
    version: '19.2.8',
    license: 'MIT',
    usedFor:
      'Declarative UI runtime powering the 4×10 patch grid, @openaxe/ui hardware controls, and embedded native editors.',
    icon: 'react',
    officialUrl: 'https://react.dev/',
    repoUrl: 'https://github.com/facebook/react',
    featured: true,
  },
  {
    name: 'Zustand',
    category: 'web',
    version: '5.0.15',
    license: 'MIT',
    usedFor:
      'Reactive client state stores managing rig graph state, preset/scene banks, MIDI bindings, and undo/redo history.',
    icon: 'layers',
    officialUrl: 'https://zustand.docs.pmnd.rs/',
    repoUrl: 'https://github.com/pmndrs/zustand',
    featured: true,
  },
  {
    name: 'p5.js',
    category: 'web',
    version: '2.3.2',
    license: 'LGPL-2.1 (GPL-3.0 §3)',
    usedFor:
      'Instance-mode audio-reactive canvas visualizations driven by live AnalyserNode taps inside the studio.',
    icon: 'p5dotjs',
    officialUrl: 'https://p5js.org/',
    repoUrl: 'https://github.com/processing/p5.js',
  },
  {
    name: 'Vite',
    category: 'web',
    version: '8.2.2',
    license: 'MIT',
    usedFor:
      'Production bundler and dev server compiling the Web Studio, embedded desktop/plugin UI bundles, and landing site.',
    icon: 'vite',
    officialUrl: 'https://vite.dev/',
    repoUrl: 'https://github.com/vitejs/vite',
  },
  {
    name: 'Tone3000',
    category: 'service',
    version: 'REST / OAuth API',
    license: 'External Service',
    usedFor:
      'Optional community tone-capture catalog letting players search and import .nam amp models and cabinet IRs.',
    brandImg: '/brands/tone3000.svg',
    officialUrl: 'https://www.tone3000.com/',
    repoUrl: 'https://github.com/tone-3000/api',
    featured: true,
  },
]
