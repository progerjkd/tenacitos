import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React Compiler rules flag many valid patterns across this codebase
      // (inline components, setState in effects, variable hoisting). Disable
      // until the codebase is fully compiler-compatible.
      "react-compiler/react-compiler": "off",
    },
  },
]);

export default eslintConfig;
