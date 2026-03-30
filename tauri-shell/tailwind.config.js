/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0e0e12',
        surface: '#161618',
        'surface-2': '#1c1c20',
        border: 'rgba(255,255,255,0.09)',
        glass: 'rgba(255, 255, 255, 0.08)',
        vibe: {
          active: '#FFB7B2',
          quiet: '#E2CEFF',
          trendy: '#B2F2BB',
          classic: '#FFE5B4',
          nature: '#C1E1C1',
          urban: '#B2E2F2',
        }
      },
      backdropBlur: {
        'apple': '25px',
        '3xl': '48px',
      },
      borderRadius: {
        'apple': '22px',
        '2.5xl': '20px',
      },
      boxShadow: {
        'glow-indigo': '0 0 20px rgba(99,102,241,0.3)',
        'glow-sm': '0 0 12px rgba(255,255,255,0.06)',
        'panel': '0 24px 72px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset',
        'card': '0 4px 24px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.4)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 6px rgba(129,140,248,0.6)' },
          '50%': { opacity: '0.7', boxShadow: '0 0 14px rgba(129,140,248,0.9)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.25s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
