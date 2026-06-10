/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sc: {
          orange: '#ff5500',
          dark: '#0d0d0d',
          surface: '#181818',
          card: '#1f1f1f',
          border: '#2a2a2a',
          muted: '#6b6b6b',
          text: '#e8e8e8'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
