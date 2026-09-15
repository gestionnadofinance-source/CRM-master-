import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // next-env.d.ts est régénéré par Next.js à chaque build ("This file
    // should not be edited") : le lint ne doit jamais porter dessus.
    ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
