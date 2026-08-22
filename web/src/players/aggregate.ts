// The profile maths lives in the APP tree (src/features/players/aggregate.ts),
// like the scoring engine the web referee imports — one copy, both clients.
// This shim keeps web's relative imports (`@/players/aggregate`, `../aggregate`
// in the tests) and the jest runs working without a path alias.
export * from "../../../src/features/players/aggregate";
