/** Ambient declarations for Vite-handled asset imports (CSS side-effects). */
declare module '*.css' {
  const css: string;
  export default css;
}
