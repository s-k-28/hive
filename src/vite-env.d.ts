/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** InsForge project base URL, e.g. https://your-app.us-east.insforge.app */
  readonly VITE_INSFORGE_URL?: string;
  /** InsForge publishable anon key, format ik_... Safe to ship in the bundle. */
  readonly VITE_INSFORGE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
