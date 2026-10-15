import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assistantPlugin } from "./vite.assistant.ts"

// ESM-safe __dirname. `import.meta.dirname` is only available on newer Node
// releases, so the URL conversion is used to keep the config portable.
const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Standalone Vite configuration. The generated project originally depended on
 * editor-specific plugins from `./.figma`; those are design-time only and made
 * the project impossible to build outside that editor, so they are replaced
 * with a plain React + Tailwind v4 setup. Everything the app needs (routing,
 * CSS, aliases, env vars) works with `npm run dev` and `npm run build`.
 */
export default defineConfig(({ mode }) => ({
  base: process.env.PUBLIC_BASE_PATH || "/",
  envPrefix: ["VITE_", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  plugins: [react(), tailwindcss(), assistantPlugin(mode)],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  build: {
    sourcemap: mode === "development",
    minify: mode !== "development",
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
    port: Number(process.env.PORT || 5173),
    strictPort: false,
  },
  preview: {
    host: true,
    port: Number(process.env.PORT || 4173),
  },
}))
