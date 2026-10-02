/**
 * @file src/types/assets.d.ts
 * Purpose: Text assets are embedded by esbuild and provided by the offline test loader.
 *
 * Table of contents:
 * 1. Ambient declarations
 */

declare module "*.css" {
    const source: string;
    export default source;
}

declare module "*.vue" {
    const source: string;
    export default source;
}
