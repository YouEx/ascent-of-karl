/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMPROVISE_ENABLED?: string;
  readonly VITE_IMPROVISE_URL?: string;
  readonly VITE_NARRATOR_URL?: string;
  readonly VITE_GAME_API_URL?: string;
  readonly VITE_ONLINE_REQUIRED?: string;
  readonly VITE_ONLINE_TARGET_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vites egne typer: import.meta.glob, import.meta.env og ?url-importer.
// Uden denne fil kender tsc ikke import.meta.glob, og src/ui/art.ts kan
// ikke slå de malede brikker op.
