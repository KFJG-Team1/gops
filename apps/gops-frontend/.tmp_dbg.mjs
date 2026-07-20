import { build } from "esbuild";
import { pathToFileURL } from "node:url";
await build({ entryPoints:["./.tmp_dbg.ts"], outfile:"./.tmp_dbg.out.mjs", bundle:true, platform:"node", format:"esm", logLevel:"silent" });
await import(pathToFileURL("./.tmp_dbg.out.mjs").href + "?t=" + Date.now());
