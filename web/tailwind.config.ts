import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        // Brand palette — keep these tokens canonical
        brand: {
          teal:        '#244855',
          'teal-deep': '#173039',
          'teal-soft': '#2e5a6a',
          vermilion:   '#E64833',
          'vermilion-soft': '#ed6e5d',
          'vermilion-deep': '#c93b27',
          terracotta:  '#874F41',
          sage:        '#90AEAD',
          'sage-deep': '#7a9594',
          cream:       '#FBE9D0',
          'cream-soft': '#fdf3e1',
        },
        // Semantic tokens (dark theme defaults)
        background:    '#0d1f25',
        foreground:    '#FBE9D0',
        muted:         'rgba(144, 174, 173, 0.85)',
        'muted-soft':  'rgba(144, 174, 173, 0.55)',
        border:        'rgba(144, 174, 173, 0.18)',
        'border-strong': 'rgba(144, 174, 173, 0.32)',
        panel:         'rgba(36, 72, 85, 0.55)',
        'panel-strong': 'rgba(36, 72, 85, 0.85)',
        accent:        '#E64833',
        success:       '#6fbf9a',
        warning:       '#f4a460',
        danger:        '#E64833',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        display: ['"Inter Display"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '0.625rem',
        lg: '0.875rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      boxShadow: {
        glass: '0 8px 30px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2)',
        'glass-lg': '0 24px 80px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)',
        'glow-vermilion': '0 0 30px -5px rgba(230, 72, 51, 0.4)',
      },
      backdropBlur: {
        glass: '18px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'shimmer': 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
export default config;
