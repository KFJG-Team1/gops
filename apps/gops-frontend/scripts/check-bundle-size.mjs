import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const assetsDirectory = resolve("dist/assets");
const maxJavaScriptBytes = Number(process.env.GOPS_MAX_JS_CHUNK_BYTES ?? 500 * 1024);
const files = await readdir(assetsDirectory);
const oversized = [];

for (const file of files.filter((name) => name.endsWith(".js"))) {
  const size = (await stat(resolve(assetsDirectory, file))).size;
  if (size > maxJavaScriptBytes) {
    oversized.push({ file, size });
  }
}

if (oversized.length > 0) {
  for (const item of oversized) {
    console.error(`${item.file}: ${item.size} bytes exceeds ${maxJavaScriptBytes} bytes`);
  }
  process.exit(1);
}

console.log(`Bundle size check passed: every JavaScript chunk is <= ${maxJavaScriptBytes} bytes.`);
