// Builds the MCP sidecar (codebase-wiki-mcp) where Tauri's externalBin expects it:
// src-tauri/binaries/codebase-wiki-mcp-<target-triple>[.exe].
//
//   node scripts/build-sidecar.mjs [triple]   build for triple (default: TAURI_ENV_TARGET_TRIPLE, else host)
//   --if-missing                              skip when the binary already exists (tauri dev)
//   --stub                                    write an empty placeholder if missing (CI test job: cargo test only)
//
// macOS is Apple Silicon only (aarch64-apple-darwin): ONNX Runtime has no prebuilt Intel build.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'src-tauri/binaries');
fs.mkdirSync(outDir, { recursive: true });

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));

function hostTriple() {
  const m = execSync('rustc -vV', { encoding: 'utf8', cwd: root }).match(/^host: (\S+)/m);
  if (!m) throw new Error('cannot parse rustc host triple');
  return m[1];
}

const triple = positional[0] || process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const ext = triple.includes('windows') ? '.exe' : '';
const dest = (t) => path.join(outDir, `codebase-wiki-mcp-${t}${ext}`);

// ONNX Runtime inside the sidecar needs the VC++ runtime, which clean Windows installs lack
// (exit -1073741515, DLL not found). Ship it next to the exes; tauri.windows.conf.json bundles it.
const VCRT = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
if (triple.includes('windows') && process.platform === 'win32') {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  for (const f of VCRT) fs.copyFileSync(path.join(sys, f), path.join(outDir, f));
}

if ((flags.has('--if-missing') || flags.has('--stub')) && fs.existsSync(dest(triple))) {
  console.log('sidecar present:', dest(triple));
  process.exit(0);
}
if (flags.has('--stub')) {
  fs.writeFileSync(dest(triple), '');
  fs.chmodSync(dest(triple), 0o755);
  console.log('sidecar stub:', dest(triple));
  process.exit(0);
}

function build(t) {
  execSync(`cargo build -p wiki-mcp --release --features embed --target ${t}`, { stdio: 'inherit', cwd: root });
  const built = path.join(root, 'target', t, 'release', `codebase-wiki-mcp${ext}`);
  fs.copyFileSync(built, dest(t));
  fs.chmodSync(dest(t), 0o755);
  console.log('sidecar:', dest(t));
}

if (triple.startsWith('x86_64-apple') || triple === 'universal-apple-darwin') {
  throw new Error('macOS Intel non supportato: ONNX Runtime non ha binari precompilati per x86_64-apple-darwin');
}
build(triple);
