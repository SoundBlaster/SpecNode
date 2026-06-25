// Dependency direction and cycle rules. Enforces the three-layer model:
// protocol/SDK (src/index.ts) <- bridge runtime (src) <- demo (examples).
// Dependencies only ever point downward.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies.",
      from: {},
      to: { circular: true },
    },
    {
      name: "src-not-to-examples",
      severity: "error",
      comment: "Protocol/SDK and bridge runtime (src) must not depend on the demo (examples).",
      from: { path: "^src/" },
      to: { path: "^examples/" },
    },
    {
      name: "protocol-stays-pure",
      severity: "error",
      comment: "The protocol/SDK entry (src/index.ts) must not depend on bridge runtime.",
      from: { path: "^src/index\\.ts$" },
      to: { path: "^src/(?!index\\.ts$).+" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".js"],
    },
  },
};
