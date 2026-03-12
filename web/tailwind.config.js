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
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        display: ['"Nunito"', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* AB steel-blue brand scale (extracted from Koinobori poster + logo) */
        ab: {
          950: '#1A3A5C',  /* --ab-ink: deepest text */
          900: '#234B72',
          800: '#2D6A9F',  /* --ab-deep */
          700: '#3A7DB5',
          600: '#4A90C4',  /* --ab-blue: primary brand */
          500: '#5BA8D9',  /* --ab-sky */
          400: '#7ABDE3',
          300: '#9BD0EC',
          200: '#B8DFF0',  /* --ab-ice */
          100: '#D6EDF7',
          50: '#F0F5FA',   /* --ab-cloud: page bg */
        },
        /* Orange/amber accent (koinobori fish + logo O-eyes) */
        accent: {
          50: '#FFF8ED',
          100: '#FFEFD4',
          200: '#FFD9A0',
          300: '#F0AC40',  /* --ab-amber */
          400: '#E8962D',  /* --ab-orange: primary accent */
          500: '#D4820F',
          600: '#B86D08',
          700: '#9A5A06',
          800: '#7C4805',
          900: '#5E3604',
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
