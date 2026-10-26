/** Charte SUNU : rouge et blanc, sobre et lisible. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sunu: { DEFAULT: "#C8102E", fonce: "#9E0B23", clair: "#FDECEF", gris: "#4A4A4A" },
      },
      fontFamily: { sans: ["Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
