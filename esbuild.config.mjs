import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
  banner: {
    js: '/*\nQuartzo Obsidian Companion V1\n*/',
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    ...builtins.map(b => `node:${b}`)],
  define: {
    'process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID': JSON.stringify(process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID || ''),
    'process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET': JSON.stringify(process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET || '')
  },
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
  metafile: true,
});

if (prod) {
  const result = await context.rebuild();
  if (result.metafile) {
    const fs = await import('fs');
    fs.writeFileSync('metafile.json', JSON.stringify(result.metafile, null, 2));
  }
  process.exit(0);
} else {
  await context.watch();
}
