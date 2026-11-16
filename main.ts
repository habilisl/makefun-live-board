// Copies this frontend into the make.fun output directory and writes dossier.json.
// Node 22 standard library only. The vendored builder is what the scorer compares against,
// so dossier.json has to be the bytes buildDossier writes for app/ and screenshots/.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

mkdirSync(out, { recursive: true });
cpSync(join(root, 'app'), join(out, 'app'), { recursive: true });
const shots = join(root, 'screenshots');
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shots)) cpSync(shots, join(out, 'screenshots'), { recursive: true });
writeFileSync(join(out, 'dossier.json'), buildDossier(out, caps));
