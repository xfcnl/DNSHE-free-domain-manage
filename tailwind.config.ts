import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f19",
        panel: "#121826",
        border: "#1f2937",
        muted: "#94a3b8",
        brand: "#38bdf8",
      },
    },
  },
  plugins: [],
};

export default config;
