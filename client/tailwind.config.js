/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cinema: {
          950: '#07090e',
          900: '#0b0f17',
          850: '#101522',
          800: '#161d2e',
          700: '#1e293b',
          600: '#334155',
          gold: '#e5a00d',
          red: '#e50914',
          accent: '#3b82f6',
          cyan: '#06b6d4',
          emerald: '#10b981'
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'glow-accent': '0 0 25px -5px rgba(59, 130, 246, 0.4)',
        'glow-gold': '0 0 25px -5px rgba(229, 160, 13, 0.4)',
        'glow-red': '0 0 25px -5px rgba(229, 9, 20, 0.4)',
        'cinema-card': '0 10px 30px -10px rgba(0, 0, 0, 0.8)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-reaction': 'floatUp 2.5s ease-out forwards',
      },
      keyframes: {
        floatUp: {
          '0%': { transform: 'translateY(0) scale(0.8)', opacity: '1' },
          '50%': { opacity: '0.9' },
          '100%': { transform: 'translateY(-180px) scale(1.4)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
