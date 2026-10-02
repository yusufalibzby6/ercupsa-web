module.exports = {
  content: ["./*.html", "./assets/**/*.js"],
  theme: {
    extend: {
      colors: {
        ercupsaRed: "#8B2323",
        ercupsaAccent: "#E23E4E",
        ercupsaDark: "#1A1A1A",
      },
    },
  },
  safelist: [
    "bg-gray-100",
    "bg-gray-200",
    "bg-green-100",
    "bg-green-600",
    "text-green-700",
    "text-gray-600",
    "opacity-90",
  ],
  plugins: [],
};
