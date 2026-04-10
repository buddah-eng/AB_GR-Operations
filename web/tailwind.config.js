/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,ts,tsx}',
  ],
  darkMode: 'selector',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Lato"', 'system-ui', 'sans-serif'],
        display: ['"M PLUS 1"', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* Primary — slate blue (neutral default, overridden by .theme-ab) */
        primary: {
          950: process.env.VITE_PRIMARY_950 ?? '#020617',
          900: process.env.VITE_PRIMARY_900 ?? '#0f172a',
          800: process.env.VITE_PRIMARY_800 ?? '#1e293b',
          700: process.env.VITE_PRIMARY_700 ?? '#334155',
          600: process.env.VITE_PRIMARY_600 ?? '#475569',
          500: process.env.VITE_PRIMARY_500 ?? '#64748b',
          400: process.env.VITE_PRIMARY_400 ?? '#94a3b8',
          300: process.env.VITE_PRIMARY_300 ?? '#cbd5e1',
          200: process.env.VITE_PRIMARY_200 ?? '#e2e8f0',
          100: process.env.VITE_PRIMARY_100 ?? '#f1f5f9',
          50: process.env.VITE_PRIMARY_50 ?? '#f8fafc',
        },
        /* Accent — warm amber (neutral default, overridden by .theme-ab) */
        accent: {
          50: process.env.VITE_ACCENT_50 ?? '#fffbeb',
          100: process.env.VITE_ACCENT_100 ?? '#fef3c7',
          200: process.env.VITE_ACCENT_200 ?? '#fde68a',
          300: process.env.VITE_ACCENT_300 ?? '#fcd34d',
          400: process.env.VITE_ACCENT_400 ?? '#fbbf24',
          500: process.env.VITE_ACCENT_500 ?? '#f59e0b',
          600: process.env.VITE_ACCENT_600 ?? '#d97706',
          700: process.env.VITE_ACCENT_700 ?? '#b45309',
          800: process.env.VITE_ACCENT_800 ?? '#92400e',
          900: process.env.VITE_ACCENT_900 ?? '#78350f',
        },
        /* Neutral surface — clean white/gray for a11y workspace areas */
        surface: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#EEEEEE',
          300: '#E0E0E0',
          400: '#BDBDBD',
          500: '#9E9E9E',
          600: '#757575',
          700: '#616161',
          800: '#424242',
          900: '#212121',
          950: '#121212',
        },
      },
    },
  },
  plugins: [
    require('tailwindcss-primeui'),
  ],
}
