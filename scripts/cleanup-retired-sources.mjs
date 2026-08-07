import fs from 'node:fs/promises';
import path from 'node:path';

const RETIRED = new Set(['\uC6B8\uC0B0\uAD11\uC5ED\uC2DC \uD0C0\uAE30\uAD00\uC18C\uC2DD']);
const DATA_DIR = 'data';
const DIAGNOSTICS_DIR = path.join(DATA_DIR, 'diagnostics');

function scrub(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => !(item && typeof item === 'object' && RETIRED.has(item.org)))
      .map(scrub);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (RETIRED.has(key)) continue;
      if (child && typeof child === 'object' && !Array.isArray(child) && RETIRED.has(child.org)) continue;
      out[key] = scrub(child);
    }
    return out;
  }
  return value;
}

async function scrubJsonFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const cleaned = scrub(parsed);
    await fs.writeFile(file, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[retired-source-cleanup] skip ${file}: ${error.message}`);
  }
}

async function removeRetiredDiagnosticDirs() {
  let entries = [];
  try {
    entries = await fs.readdir(DIAGNOSTICS_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(DIAGNOSTICS_DIR, entry.name);
    let retired = false;
    for (const name of ['diagnosis.json', 'evidence.json']) {
      try {
        const text = await fs.readFile(path.join(dir, name), 'utf8');
        if ([...RETIRED].some(org => text.includes(org))) retired = true;
      } catch { /* generated folders can be partial */ }
    }
    if (retired) {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`[retired-source-cleanup] removed ${dir}`);
    }
  }
}

await removeRetiredDiagnosticDirs();
for (const name of [
  'pipeline-report.json',
  'pipeline-report.previous.json',
  'pipeline-diff.json',
  'regression-report.json',
  'pipeline-history.json',
  'pipeline-artifacts.json',
  'debug-report.json',
  'jobs.json',
  'qa-report.json'
]) {
  await scrubJsonFile(path.join(DATA_DIR, name));
}
