declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

// The slice of Vite's client types the game actually uses. Pulled in by hand rather than via
// `"types": ["vite/client"]` so `tsc --noEmit` stays independent of what is in node_modules.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
