// Loads the project's .env before any test file runs, so getServerEnv()
// (src/lib/env.ts) sees DATABASE_URL / SESSION_* / etc. exactly like the
// Next.js dev server does. Vitest does not read .env on its own.
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../.env") });
