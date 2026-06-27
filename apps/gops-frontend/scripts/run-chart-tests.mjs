import { mkdir, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = new URL("../.tmp/chart-runtime-test.mjs", import.meta.url);
const chartEngineRoot = fileURLToPath(new URL("../../chart-engine/src/", import.meta.url));
await mkdir(new URL("../.tmp/", import.meta.url), { recursive: true });

const chartEngineAliasPlugin = {
  name: "chart-engine-alias",
  setup(build) {
    build.onResolve({ filter: /^@gops\/chart-engine$/ }, () => ({
      path: `${chartEngineRoot}index.ts`
    }));
    build.onResolve({ filter: /^@gops\/chart-engine\/(.+)$/ }, (args) => ({
      path: `${chartEngineRoot}${args.path.replace("@gops/chart-engine/", "")}.ts`
    }));
  }
};

try {
  await build({
    entryPoints: [fileURLToPath(new URL("../tests/chartRuntime.test.ts", import.meta.url))],
    outfile: fileURLToPath(outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: false,
    plugins: [chartEngineAliasPlugin],
    logLevel: "silent"
  });

  await import(`${pathToFileURL(fileURLToPath(outfile)).href}?t=${Date.now()}`);
  console.log("chart runtime tests passed");
} finally {
  await unlink(outfile).catch(() => undefined);
}
