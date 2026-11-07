import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Type declarations for the Supabase Edge Function. They are
    // TypeScript-only files for the Deno runtime and use syntax the
    // lint parser does not read.
    "supabase/functions/**/*.d.mts",
  ]),
]);

export default eslintConfig;
