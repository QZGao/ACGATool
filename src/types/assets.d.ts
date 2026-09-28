/** Text assets are embedded by esbuild and provided by the offline test loader. */
declare module "*.css" {
    const source: string;
    export default source;
}

declare module "*.vue" {
    const source: string;
    export default source;
}
