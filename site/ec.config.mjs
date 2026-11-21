import { defineEcConfig } from '@astrojs/starlight/expressive-code';
import { pluginCodeNames } from './src/lib/code-names.mjs';

// Read by Starlight's Code component as well as by the Markdown renderer. The Code component
// needs the options in this file because the plugin is a function, which cannot sit in
// astro.config.mjs.
export default defineEcConfig({
  themes: ['github-dark', 'github-light'],
  // Names every block, so the ones that scroll are not anonymous, duplicate regions.
  plugins: [pluginCodeNames()],
  defaultProps: {
    // A line that is still too long wraps, so no block scrolls sideways.
    wrap: true,
    // Shell commands get the same plain frame as code, not a terminal window.
    overridesByLang: { 'bash,sh,shell,zsh': { frame: 'code' } },
  },
  // A plain bordered frame. A file name is small gray text over a line, not an editor tab.
  // The colors are variables that custom.css sets for each theme.
  styleOverrides: {
    borderRadius: '0.625rem',
    borderColor: 'var(--sl-color-gray-5)',
    codeBackground: 'var(--code-surface)',
    codeFontSize: '0.8125rem',
    codeLineHeight: '1.7',
    codePaddingBlock: '1rem',
    codePaddingInline: '1.25rem',
    uiFontFamily: 'var(--sl-font-mono)',
    uiFontSize: '0.75rem',
    frames: {
      shadowColor: 'transparent',
      frameBoxShadowCssValue: 'none',
      editorTabBarBackground: 'var(--code-surface)',
      editorTabBarBorderColor: 'var(--sl-color-gray-5)',
      editorTabBarBorderBottomColor: 'var(--sl-color-gray-5)',
      // Transparent, so the line below the file name runs the full width of the frame.
      editorActiveTabBackground: 'transparent',
      editorActiveTabForeground: 'var(--sl-color-gray-3)',
      editorActiveTabBorderColor: 'transparent',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: 'transparent',
    },
  },
});
