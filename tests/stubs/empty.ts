// Test stub for the `server-only` / `client-only` marker packages, which throw
// when imported outside their intended bundler environment. In tests we run
// server modules under Node, so we neutralise the guard here.
export {};
