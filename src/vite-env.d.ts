/// <reference types="vite/client" />

// Gives `import.meta.env.BASE_URL` a type (used by the engine worker URL and
// the piece-asset paths) and makes side-effect CSS imports legal.

/** Injected by vite.config.ts — see the build-stamp note there. */
declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string
