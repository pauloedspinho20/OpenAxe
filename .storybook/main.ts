import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../packages/ui/src/**/*.mdx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: '@storybook/react-vite',
  viteFinal: async (config) => {
    config.plugins = config.plugins ?? []
    config.plugins.push({
      name: 'media-var-replace',
      transform(code: string, id: string) {
        if (id.endsWith('.css')) {
          return code
            .replace(/var\(--mw-xxs\)/g, '320px')
            .replace(/var\(--mw-xs\)/g, '520px')
            .replace(/var\(--mw-sm\)/g, '640px')
            .replace(/var\(--mw-md\)/g, '720px')
            .replace(/var\(--mw-lg\)/g, '920px')
            .replace(/var\(--mw-xl\)/g, '1200px')
            .replace(/var\(--mw-xxl\)/g, '1600px')
        }
      },
    })
    return config
  },
}

export default config
