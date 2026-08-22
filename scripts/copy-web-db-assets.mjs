import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
for (const file of ['sql-wasm.wasm', 'sql-wasm-browser.wasm']) {
  await copyFile(require.resolve(`sql.js/dist/${file}`), new URL(`../public/${file}`, import.meta.url));
}
