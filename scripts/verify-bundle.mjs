import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const bundledCodeMirrorModules = [
  "@codemirror/state/dist/index.js",
  "@codemirror/view/dist/index.js"
].filter((module) => bundle.includes(module));

if (bundledCodeMirrorModules.length) {
  throw new Error(
    `main.js must use Obsidian's CodeMirror runtime, not bundle: ${bundledCodeMirrorModules.join(", ")}`
  );
}
