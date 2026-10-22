import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const buildOptions = {
  entryPoints: ['src/main.js'],
  outfile: 'dist/bundled.js',
  bundle: true,
  format: 'iife',
  charset: 'utf8',
  target: ['es2017'],
  minify: minify,
  sourcemap: false,
  banner: { js: `// Main page: [[User:SuperGrey/gadgets/ACGATool]]
// <nowiki>` },
  footer: { js: '// </nowiki>' },
  logLevel: 'info'
};

(async () => {
  try {
    if (watch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('[ACGATool build] Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('[ACGATool build] Build complete');
    }
  } catch (e) {
    console.error('[ACGATool build] Build failed:', e);
    process.exit(1);
  }
})();
