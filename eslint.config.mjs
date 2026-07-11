import { config } from "@remotion/eslint-config-flat";

// ---- M6 determinism fence -------------------------------------------------
// Everything downstream of an approved Bible must be a pure function of it.
// These rules mechanically ban the primitives that break that promise inside
// the deterministic modules. `src/renderer` is exempt only from the Remotion
// import ban — it is the one module allowed to know Remotion exists — but
// wall-clock time and randomness are banned there too, since a renderer that
// paints differently on each run is just as nondeterministic as a compiler
// that plans differently.
const DETERMINISTIC_MODULES = [
  "src/assets/**/*.{ts,tsx}",
  "src/bible/**/*.{ts,tsx}",
  "src/compiler/**/*.{ts,tsx}",
  "src/recipes/**/*.{ts,tsx}",
  "src/render-plan/**/*.{ts,tsx}",
  "src/stage/**/*.{ts,tsx}",
];

const nondeterminismBans = {
  "no-restricted-properties": [
    "error",
    {
      object: "Math",
      property: "random",
      message: "Nondeterministic: banned in the deterministic pipeline (M6).",
    },
    {
      object: "Date",
      property: "now",
      message: "Wall-clock time: banned in the deterministic pipeline (M6).",
    },
    {
      object: "performance",
      property: "now",
      message: "Wall-clock time: banned in the deterministic pipeline (M6).",
    },
    {
      object: "crypto",
      property: "randomUUID",
      message: "Nondeterministic: banned in the deterministic pipeline (M6).",
    },
    {
      object: "crypto",
      property: "getRandomValues",
      message: "Nondeterministic: banned in the deterministic pipeline (M6).",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: 'NewExpression[callee.name="Date"]',
      message: "Wall-clock time: banned in the deterministic pipeline (M6).",
    },
  ],
};

export default [
  ...config,
  {
    files: DETERMINISTIC_MODULES,
    rules: {
      ...nondeterminismBans,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "remotion",
              message:
                "Only src/renderer may import Remotion — everything else is renderer-agnostic pure TypeScript.",
            },
          ],
          // I/O reintroduces environment dependence; the deterministic
          // modules compute from their arguments and nothing else.
          patterns: [
            "node:*",
            "fs",
            "path",
            "os",
            "crypto",
            "child_process",
            "http",
            "https",
          ],
        },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    rules: nondeterminismBans,
  },
];
