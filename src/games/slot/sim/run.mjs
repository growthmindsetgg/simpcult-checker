// Runs the TypeScript RTP sim with plain Node 24 (built-in type stripping), no
// extra dependencies. The resolve hook lets extensionless relative imports
// ("./config") find their .ts files, the way the Next bundler does.
//
//   node src/games/slot/sim/run.mjs            # 1,000,000 spins
//   node src/games/slot/sim/run.mjs 200000     # custom spin count
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

registerHooks({
  resolve(spec, ctx, next) {
    let r;
    try {
      r = next(spec, ctx);
    } catch (e) {
      if (spec.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(spec)) r = next(`${spec}.ts`, ctx);
      else throw e;
    }
    if (r.url.endsWith(".ts")) r = { ...r, format: "module-typescript" };
    return r;
  },
});

const here = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(here, "rtp.ts")).href);
