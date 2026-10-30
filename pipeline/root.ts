/**
 * The repo root. Every entry point (pnpm scripts, vitest, next dev/start) runs from it, and
 * process.cwd() survives bundling where import.meta.url does not.
 */
import { join } from "node:path";

export const ROOT = process.env.LIM_ROOT ?? join(process.cwd(), "/");
