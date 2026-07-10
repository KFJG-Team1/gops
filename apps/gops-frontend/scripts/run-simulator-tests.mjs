import { mkdir, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = new URL("../.tmp/simulator-ui-test.mjs", import.meta.url);
await mkdir(new URL("../.tmp/", import.meta.url), { recursive: true });

try {
  await build({
    entryPoints: [fileURLToPath(new URL("../tests/simulatorUi.test.ts", import.meta.url))],
    outfile: fileURLToPath(outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: false,
    logLevel: "silent"
  });
  await import(`${pathToFileURL(fileURLToPath(outfile)).href}?t=${Date.now()}`);
} finally {
  await unlink(outfile).catch(() => undefined);
}
