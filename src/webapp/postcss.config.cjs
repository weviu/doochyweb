const path = require("node:path");

module.exports = {
  plugins: {
    // Point tailwind at the config explicitly: pnpm runs with cwd = the repo
    // root, so tailwind's own config lookup from process.cwd() would not find a
    // config sitting in src/webapp.
    tailwindcss: { config: path.resolve(__dirname, "../../tailwind.config.cjs") },
    autoprefixer: {},
  },
};