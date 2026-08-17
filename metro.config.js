/**
 * Metro config — Expo defaults plus one resolver rule for the OPTIONAL
 * "racquet-analyzer" Expo local module (modules/racquet-analyzer/):
 *
 * - When the module exists (a dev build with the on-device analyzer), the
 *   bare name resolves normally — extraNodeModules points it at modules/.
 * - When it does not exist (Expo Go, or the module not landed yet), the name
 *   resolves to Metro's empty module instead of failing the whole bundle.
 *   deviceClient.ts narrows the empty export to "unavailable" at runtime and
 *   the import flow falls back to the analysis-server path.
 *
 * Without this rule the require("racquet-analyzer") in
 * src/features/analysis/deviceClient.ts — deliberately a runtime require so
 * Expo Go never crashes — would still break BUNDLING whenever the module
 * directory is absent, because Metro resolves string-literal requires
 * statically.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "racquet-analyzer": path.join(__dirname, "modules", "racquet-analyzer"),
};

const priorResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const chain = priorResolveRequest ?? context.resolveRequest;
  if (moduleName === "racquet-analyzer") {
    try {
      return chain(context, moduleName, platform);
    } catch {
      return { type: "empty" };
    }
  }
  return chain(context, moduleName, platform);
};

module.exports = config;
