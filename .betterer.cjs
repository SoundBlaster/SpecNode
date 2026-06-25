const { eslint } = require("@betterer/eslint");

// Ratchet for the lenient zone. The demo (examples) is exempt from the strict
// size/complexity ESLint rules, but Betterer holds a baseline of the current
// violations: new ones fail, and the count can only go down. Regenerate the
// baseline intentionally with `npm run betterer`; CI runs `npm run betterer:ci`.
module.exports = {
  "examples stay within strict size and complexity (ratchet)": () =>
    eslint({
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 10],
    }).include("./examples/**/*.ts"),
};
