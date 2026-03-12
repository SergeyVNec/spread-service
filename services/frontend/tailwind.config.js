/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'monospace'],
        sans: ['var(--font-sans)', 'sans-serif'],
      },
      colors: {
        bg:      '#0a0a0f',
        surface: '#0f0f17',
        border:  '#1a1a2e',
        dim:     '#2a2a3e',
        muted:   '#4a4a6a',
        text:    '#c8c8e0',
        bright:  '#e8e8ff',
        green:   '#00d4aa',
        red:     '#ff4466',
        yellow:  '#ffcc44',
        blue:    '#4488ff',
        purple:  '#aa66ff',
      },
      animation: {
        'pulse-fast': 'pulse 0.8s ease-in-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
