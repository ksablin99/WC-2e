'use strict';

/**
 * srd-setup.js — Download and unpack the D&D 3.5e SRD to .srd/
 *
 * Source: http://dndsrd.net/sovelior_sage_srd.zip
 * Output: .srd/ (gitignored)
 *
 * Usage: npm run srd:setup
 * Skips download if .srd/ already exists (pass --force to re-download).
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRD_URL = 'http://dndsrd.net/sovelior_sage_srd.zip';
const ZIP_PATH = path.join(ROOT, '.srd.zip');
const SRD_DIR = path.join(ROOT, '.srd');
const FORCE = process.argv.includes('--force');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    const request = proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r  Downloading... ${pct}%`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
    });

    request.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

function extract(zipPath, destDir) {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

async function main() {
  if (!FORCE && fs.existsSync(SRD_DIR)) {
    const files = fs.readdirSync(SRD_DIR);
    if (files.length > 0) {
      console.log(`.srd/ already exists (${files.length} entries). Use --force to re-download.`);
      return;
    }
  }

  console.log(`Downloading SRD from ${SRD_URL} ...`);
  await download(SRD_URL, ZIP_PATH);

  console.log(`Extracting to .srd/ ...`);
  if (fs.existsSync(SRD_DIR)) fs.rmSync(SRD_DIR, { recursive: true });
  fs.mkdirSync(SRD_DIR, { recursive: true });
  extract(ZIP_PATH, SRD_DIR);

  fs.unlinkSync(ZIP_PATH);
  console.log('Done. SRD is available at .srd/');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
