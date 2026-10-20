import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = fileURLToPath(new URL('../public/', import.meta.url));
const source = new URL('../../web/static/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, new URL('../public/static/', import.meta.url), { recursive: true, filter: path => !path.endsWith('.test.mjs') });
await copyFile(new URL('templates/index.html', source), new URL('../public/index.html', import.meta.url));
console.log('Atlas dashboard built in dashboard/public');
