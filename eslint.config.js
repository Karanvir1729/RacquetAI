const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["node_modules/*", ".expo/*", ".worktrees/*", "expo-env.d.ts", "dist/*"],
  },
]);
