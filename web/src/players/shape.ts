// The player-profile domain lives in the APP tree (src/features/players/shape.ts),
// like the scoring engine the web referee imports — one copy, both clients.
// This shim keeps web's relative imports (`@/players/shape`, `../shape` in the
// tests) and the jest runs working without a path alias.
export * from "../../../src/features/players/shape";
