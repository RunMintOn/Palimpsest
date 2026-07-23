import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  external: ["obsidian"],
  format: "cjs",
  target: "es2022",
  sourcemap: "inline",
  logLevel: "info"
});
