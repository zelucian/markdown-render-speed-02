import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const cases: { id: string; markdown: string }[] = JSON.parse(
  await readFile(join(inputDir, 'cases.json'), 'utf8'),
);
const html = cases.map(({ markdown }) => parse(markdown));
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'html.json'), JSON.stringify(html));
