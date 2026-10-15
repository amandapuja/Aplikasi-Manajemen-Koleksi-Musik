/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Supabase project URL, e.g. https://abcdefgh.supabase.co.
   */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase project URL using the Next.js public environment variable name. */
  readonly NEXT_PUBLIC_SUPABASE_URL?: string
  /**
   * Supabase anonymous or publishable key. Safe to ship in the browser;
   * Row Level Security protects the data. Never put the service-role key here.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Supabase publishable key using the Next.js public environment variable name. */
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
  /** Name of the deployed Edge Function. Defaults to server. */
  readonly VITE_SUPABASE_FUNCTIONS_NAME?: string
  /** Storage bucket used for uploaded material files. Defaults to materials. */
  readonly VITE_SUPABASE_MATERIALS_BUCKET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const source: string
  export default source
}
