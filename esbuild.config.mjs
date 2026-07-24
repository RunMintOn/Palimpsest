import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  // Obsidian owns the CodeMirror runtime. Bundling a second copy causes its
  // extension values to fail Obsidian's instanceof checks when a note opens.
  external: ["obsidian", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2022",
  sourcemap: "inline",
  logLevel: "info"
});
