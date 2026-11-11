import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'src-tauri/binaries');
fs.mkdirSync(outDir, { recursive: true });

function hostTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8', cwd: root });
  const m = out.match(/^host: (\S+)/m);
  if (!m) throw new Error('cannot parse rustc host triple');
  return m[1];
}

function copyBinary(triple) {
  const ext = triple.includes('windows') ? '.exe' : '';
  const srcTarget = path.join(root, 'target', triple, 'release', `codebase-wiki-mcp${ext}`);
  const srcHost = path.join(root, 'target', 'release', `codebase-wiki-mcp${ext}`);
  const src = fs.existsSync(srcTarget) ? srcTarget : srcHost;
  const dest = path.join(outDir, `codebase-wiki-mcp-${triple}${ext}`);
  fs.copyFileSync(src, dest);
  console.log('sidecar:', dest);
}

const universal = process.env.TAURI_UNIVERSAL === '1';
if (universal) {
  for (const triple of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    execSync(`cargo build -p wiki-mcp --release --features embed --target ${triple}`, {
      stdio: 'inherit',
      cwd: root,
    });
  }
  const fat = path.join(outDir, 'codebase-wiki-mcp-universal-apple-darwin');
  execSync(
    `lipo -create target/aarch64-apple-darwin/release/codebase-wiki-mcp target/x86_64-apple-darwin/release/codebase-wiki-mcp -output ${fat}`,
    { cwd: root, stdio: 'inherit' },
  );
} else {
  const triple = process.argv[2] || hostTriple();
  execSync(`cargo build -p wiki-mcp --release --features embed --target ${triple}`, {
    stdio: 'inherit',
    cwd: root,
  });
  copyBinary(triple);
}
