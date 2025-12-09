const defaultTheme = require('tailwindcss/defaultTheme');
const plugin = require('tailwindcss/plugin');

const EXTENDED_SPACING = {
  2.5: '0.625rem',
  3.5: '0.875rem',
  4.5: '1.125rem',
  5.5: '1.375rem',
  6.5: '1.625rem',
  7.5: '1.875rem',
  9.5: '2.375rem',
  11: '2.75rem',
  13: '3.25rem',
  15: '3.75rem',
  18: '4.5rem',
  21: '5.25rem',
  22: '5.5rem',
  26: '6.5rem',
  30: '7.5rem',
  34: '8.5rem',
  42: '10.5rem',
  55: '13.75rem',
  72: '18rem',
  89: '22.25rem',
  120: '30rem',
  144: '36rem',
};

const FONT_SCALE = {
  micro: ['0.7rem', { lineHeight: '1rem' }],
  xs: ['0.8rem', { lineHeight: '1.15rem' }],
  sm: ['0.9rem', { lineHeight: '1.35rem' }],
  base: ['1rem', { lineHeight: '1.5rem' }],
  lg: ['1.125rem', { lineHeight: '1.75rem' }],
  xl: ['1.375rem', { lineHeight: '2rem' }],
  '2xl': ['1.625rem', { lineHeight: '2.25rem' }],
  '3xl': ['1.875rem', { lineHeight: '2.5rem' }],
  '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
  display: ['3rem', { lineHeight: '1.1' }],
};

const BRAND_COLORS = {
  stratosort: {
    blue: '#2563EB',
    'blue-soft': '#3B82F6',
    indigo: '#4C1D95',
    accent: '#F59E0B',
    coral: '#FB7185',
    success: '#10B981',
    warning: '#F97316',
    danger: '#EF4444',
  },
  surface: {
    primary: '#FFFFFF',
    muted: '#F8FAFC',
    subdued: '#EEF2FF',
    elevated: '#FFFFFF',
    contrast: '#0F172A',
  },
  border: {
    soft: '#E2E8F0',
    medium: '#CBD5E1',
    strong: '#94A3B8',
  },
  system: {
    blue: '#2563EB',
    green: '#10B981',
    orange: '#F97316',
    red: '#EF4444',
    purple: '#8B5CF6',
    pink: '#DB2777',
    gray: {
      25: '#FCFCFD',
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
    },
  },
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{html,js,ts,jsx,tsx}',
    './src/**/*.{html,js,ts,jsx,tsx}',
  ],
  safelist: [
    // Status utilities (use .status-chip.success etc)
    'status-chip',
    // Button variants
    'btn-primary',
    'btn-secondary',
    'btn-success',
    'btn-danger',
    'btn-ghost',
    'btn-outline',
    'btn-subtle',
    // Layout helpers
    'container-responsive',
    'surface-panel',
    'surface-card',
    'glass-panel',
    // DaisyUI component classes
    'btn',
    'btn-sm',
    'btn-lg',
    'btn-active',
    'btn-square',
    'card',
    'card-body',
    'card-title',
    'card-actions',
    'badge',
    'badge-primary',
    'badge-secondary',
    'badge-success',
    'badge-warning',
    'badge-error',
    'badge-info',
    'badge-outline',
    'badge-sm',
    'tabs',
    'tabs-boxed',
    'tab',
    'tab-lg',
    'tab-active',
    'stats',
    'stat',
    'stat-title',
    'stat-value',
    'stat-desc',
    'stat-figure',
    'alert',
    'alert-info',
    'alert-success',
    'alert-warning',
    'alert-error',
    'progress',
    'progress-primary',
    'progress-secondary',
    'progress-success',
    'progress-warning',
    'progress-error',
    'progress-info',
    'progress-accent',
    'modal',
    'modal-open',
    'modal-box',
    'modal-backdrop',
    'modal-action',
    'input',
    'input-bordered',
    'input-sm',
    'input-group',
    'select',
    'select-bordered',
    'textarea',
    'textarea-bordered',
    'toggle',
    'toggle-success',
    'toggle-warning',
    'toggle-accent',
    'toggle-info',
    'range',
    'range-primary',
    'range-secondary',
    'form-control',
    'label',
    'label-text',
    'label-text-alt',
    'divider',
    'divider-horizontal',
    'btn-group',
    'table',
    'table-zebra',
    // Color variations with opacity
    'bg-primary/10',
    'bg-secondary/10',
    'bg-success/10',
    'bg-accent/10',
    'bg-warning/10',
    'bg-info/10',
    'bg-error/10',
    'bg-neutral/10',
    'text-primary',
    'text-secondary',
    'text-success',
    'text-accent',
    'text-warning',
    'text-info',
    'text-error',
    'text-neutral',
    'border-primary',
    'border-secondary',
    'border-success',
    'border-accent',
    'border-warning',
    'border-info',
    'border-error',
    'border-neutral',
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1.5rem',
        lg: '2rem',
        xl: '3rem',
      },
    },
    extend: {
      screens: {
        xl: '1280px',
        '2xl': '1440px',
        '3xl': '1600px',
        '4xl': '1920px',
        '5xl': '2560px',
      },
      spacing: EXTENDED_SPACING,
      maxWidth: {
        'screen-xl': '1280px',
        'screen-2xl': '1440px',
        'screen-3xl': '1600px',
        'screen-4xl': '1920px',
        'content-lg': '72rem',
        'content-xl': '90rem',
        'content-2xl': '105rem',
        'content-md': '56rem',
      },
      gridTemplateColumns: {
        // Auto-fit grids - items stretch to fill available space
        'auto-fit-xs': 'repeat(auto-fit, minmax(150px, 1fr))',
        'auto-fit-sm': 'repeat(auto-fit, minmax(200px, 1fr))',
        'auto-fit-md': 'repeat(auto-fit, minmax(280px, 1fr))',
        'auto-fit-lg': 'repeat(auto-fit, minmax(320px, 1fr))',
        'auto-fit-xl': 'repeat(auto-fit, minmax(400px, 1fr))',
        // Auto-fill grids - items maintain size, empty columns created
        'auto-fill-xs': 'repeat(auto-fill, minmax(150px, 1fr))',
        'auto-fill-sm': 'repeat(auto-fill, minmax(200px, 1fr))',
        'auto-fill-md': 'repeat(auto-fill, minmax(280px, 1fr))',
        'auto-fill-lg': 'repeat(auto-fill, minmax(320px, 1fr))',
        'auto-fill-xl': 'repeat(auto-fill, minmax(400px, 1fr))',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
      fontSize: FONT_SCALE,
      colors: {
        ...BRAND_COLORS,
        gradient: {
          'primary-start': '#667EEA',
          'primary-end': '#764BA2',
          'secondary-start': '#F093FB',
          'secondary-end': '#F5576C',
          'accent-start': '#4FACFE',
          'accent-end': '#00F2FE',
        },
      },
      borderRadius: {
        xs: '0.125rem',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.5rem',
        glass: '1.75rem',
        button: '999px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(15, 23, 42, 0.08)',
        sm: '0 5px 15px rgba(15, 23, 42, 0.06)',
        md: '0 15px 35px rgba(15, 23, 42, 0.08)',
        lg: '0 25px 45px rgba(15, 23, 42, 0.12)',
        xl: '0 35px 65px rgba(15, 23, 42, 0.14)',
        glow: '0 0 25px rgba(37, 99, 235, 0.35)',
        glass: '0 20px 45px rgba(15, 23, 42, 0.25)',
      },
      backdropBlur: {
        xs: '2px',
        sm: '6px',
        DEFAULT: '12px',
        lg: '16px',
        xl: '22px',
      },
      dropShadow: {
        card: '0 30px 45px rgba(15, 23, 42, 0.12)',
        glow: '0 15px 45px rgba(37, 99, 235, 0.35)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
        snappy: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      zIndex: {
        header: 100,
        overlay: 200,
        toast: 500,
        modal: 600,
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-backdrop': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-enter': {
          '0%': {
            opacity: '0',
            transform: 'translate3d(0, -8px, 0) scale(0.98)',
          },
          '100%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0) scale(1)',
          },
        },
        'confirm-bounce': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.03)' },
        },
        'slide-up': {
          '0%': {
            opacity: '0',
            transform: 'translate3d(0, 12px, 0)',
          },
          '100%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0)',
          },
        },
        'slide-in-right': {
          '0%': {
            opacity: '0',
            transform: 'translate3d(12px, 0, 0)',
          },
          '100%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0)',
          },
        },
        float: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -8px, 0)' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -4px, 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'modal-backdrop': 'modal-backdrop 0.15s ease-out',
        'modal-enter': 'modal-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'confirm-bounce': 'confirm-bounce 0.25s ease-in-out',
        'slide-up': 'slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        float: 'float 3s ease-in-out infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('daisyui'),
    // Custom plugin for dynamic auto-fit/auto-fill grid utilities
    plugin(function ({ matchUtilities, theme }) {
      matchUtilities(
        {
          'grid-auto-fit': (value) => ({
            gridTemplateColumns: `repeat(auto-fit, minmax(min(${value}, 100%), 1fr))`,
          }),
          'grid-auto-fill': (value) => ({
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${value}, 100%), 1fr))`,
          }),
        },
        { values: theme('spacing') }
      );
    }),
  ],
  daisyui: {
    themes: [
      {
        stratosort: {
          // Aligned with BRAND_COLORS.stratosort
          primary: '#2563EB',      // stratosort-blue
          secondary: '#8B5CF6',    // system.purple
          accent: '#F59E0B',       // stratosort-accent (amber)
          neutral: '#334155',      // system-gray-700
          'base-100': '#FFFFFF',   // surface-primary
          'base-200': '#F8FAFC',   // surface-muted
          'base-300': '#F1F5F9',   // system-gray-100
          info: '#2563EB',         // stratosort-blue (was #3B82F6)
          success: '#10B981',      // stratosort-success
          warning: '#F97316',      // stratosort-warning (was #F59E0B)
          error: '#EF4444',        // stratosort-danger
        },
      },
    ],
    darkTheme: false,
    base: true,
    styled: true,
    utils: true,
  },
};
