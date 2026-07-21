/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // Scans the main web workspace
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./apps/web/index.html",
    "./apps/web/src/**/*.{js,ts,jsx,tsx}",
    
    // Scans your shared components workspace
    "./packages/shared/src/**/*.{js,ts,jsx,tsx}",
    "../shared/src/**/*.{js,ts,jsx,tsx}",
    "../../packages/shared/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: "#050505",
          900: "#0a0a0a",
          800: "#121212",
          700: "#1a1a1a",
          600: "#262626",
        },
        metallic: {
          light: "#f3f4f6",
          silver: "#9ca3af",
          dark: "#4b5563",
        },
        fire: {
          DEFAULT: "#f97316",
          light: "#fdba74",
          dark: "#ea580c",
        },
      },
      animation: {
        strobe: "strobe 0.2s ease-in-out",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 12s linear infinite",
      },
      keyframes: {
        strobe: {
          "0%, 100%": { opacity: "0.2" },
          "50%": { opacity: "1", filter: "brightness(2)" },
        },
      },
    },
  },
  plugins: [],
}
