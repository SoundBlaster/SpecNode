// Deterministic coupling / size / complexity limits.
//
// Mode: src is held strictly; examples and tests keep the coupling and
// suppression-audit rules but relax size and complexity (the demo owns a large
// HTML generator). Layering and cycles are enforced separately by
// dependency-cruiser; the lenient zones are ratcheted downward by Betterer.
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["import", "@eslint-community/eslint-comments"],
  ignorePatterns: [
    "dist/",
    "node_modules/",
    ".claude/",
    "*.cjs",
  ],
  rules: {
    // Suppression audit: an eslint-disable must carry a written justification.
    "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
    // Coupling (everywhere).
    "max-params": ["error", 8],
    "import/max-dependencies": ["error", { max: 15, ignoreTypeImports: true }],
    // Complexity (everywhere except the relaxed zones below).
    complexity: ["error", 10],
  },
  overrides: [
    {
      // Protocol/SDK and bridge runtime are held to the size limits.
      files: ["src/**/*.ts"],
      rules: {
        "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
        "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // Demos and tests: keep coupling + suppression audit, relax size/complexity.
      files: ["examples/**/*.ts", "tests/**/*.ts"],
      rules: {
        "max-lines": "off",
        "max-lines-per-function": "off",
        complexity: "off",
      },
    },
  ],
};
