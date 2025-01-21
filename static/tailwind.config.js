/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{html,js}", // Scans all HTML and JS files in the 'pages' directory
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('daisyui'), // DaisyUI plugin
  ],
  daisyui: {
    themes: ["dark", "light"], // Default themes with 'dark' first
  },
};
