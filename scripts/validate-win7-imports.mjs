import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// A denylist for known startup blockers, not an exhaustive Win7 API contract.
const unsupportedDll = /^(?:combase|shcore)\.dll$|^api-ms-win-core-(?:winrt|path)-/i;
const unsupportedFunctions = new Set([
  'RoOriginateErrorW', 'RoInitialize', 'RoGetActivationFactory', 'RoGetAgileReference',
  'CoIncrementMTAUsage', 'CoDecrementMTAUsage',
  'GetSystemTimePreciseAsFileTime', 'WaitOnAddress', 'WakeByAddressSingle', 'WakeByAddressAll',
  'SetThreadDescription', 'GetThreadDescription', 'GetDpiForWindow', 'GetDpiForSystem',
  'GetDpiForMonitor', 'SetProcessDpiAwareness', 'SetProcessDpiAwarenessContext',
]);

export function readPeImports(buffer) {
  const range = (offset, size) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > buffer.length) {
      throw new Error('Truncated or invalid PE structure');
    }
    return offset;
  };
  const u16 = (o) => buffer.readUInt16LE(range(o, 2));
  const u32 = (o) => buffer.readUInt32LE(range(o, 4));
  if (u16(0) !== 0x5a4d) throw new Error('Missing DOS signature');
  const pe = u32(0x3c);
  if (u32(pe) !== 0x4550) throw new Error('Missing PE signature');
  const machine = u16(pe + 4);
  const sectionCount = u16(pe + 6);
  const optionalSize = u16(pe + 20);
  const optional = pe + 24;
  range(optional, optionalSize);
  if (optionalSize < 112 || u16(optional) !== 0x20b) throw new Error('Expected PE32+ x64 image');
  const imageBase = Number(buffer.readBigUInt64LE(range(optional + 24, 8)));
  const directoryCount = Math.min(u32(optional + 108), Math.floor((optionalSize - 112) / 8));
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = optional + optionalSize + i * 40;
    range(s, 40);
    sections.push({ rva: u32(s + 12), size: u32(s + 16), offset: u32(s + 20) });
  }
  const locate = (rva, size = 1) => {
    const section = sections.find((s) => rva >= s.rva && rva + size <= s.rva + s.size);
    if (!section) throw new Error(`PE RVA outside raw section: 0x${rva.toString(16)}`);
    return range(section.offset + rva - section.rva, size);
  };
  const stringAt = (rva) => {
    const start = locate(rva);
    const section = sections.find((s) => rva >= s.rva && rva < s.rva + s.size);
    const limit = Math.min(buffer.length, section.offset + section.size, start + 4096);
    const end = buffer.indexOf(0, start);
    if (end < start || end >= limit) throw new Error('Unterminated PE import name');
    return buffer.toString('ascii', start, end);
  };
  const directory = (index) => index < directoryCount
    ? { rva: u32(optional + 112 + index * 8), size: u32(optional + 116 + index * 8) }
    : { rva: 0, size: 0 };
  const imports = [];
  for (const [index, kind, descriptorSize] of [[1, 'import', 20], [13, 'delay', 32]]) {
    const dir = directory(index);
    if (!dir.rva) continue;
    if (dir.size < descriptorSize) throw new Error('Invalid PE import directory size');
    let terminated = false;
    for (let i = 0; i + descriptorSize <= dir.size; i += descriptorSize) {
      const d = locate(dir.rva + i, descriptorSize);
      if (buffer.subarray(d, d + descriptorSize).every((b) => b === 0)) { terminated = true; break; }
      const relative = (value) => kind !== 'delay' || (u32(d) & 1) ? value : value - imageBase;
      const dllRva = relative(u32(d + (kind === 'delay' ? 4 : 12)));
      const thunkRva = relative(kind === 'delay' ? u32(d + 16) : (u32(d) || u32(d + 16)));
      const symbols = [];
      if (!thunkRva) throw new Error('Missing PE import lookup table');
      let thunkTerminated = false;
      for (let j = 0; j < 65536; j++) {
        const thunk = buffer.readBigUInt64LE(locate(thunkRva + j * 8, 8));
        if (thunk === 0n) { thunkTerminated = true; break; }
        symbols.push(thunk & (1n << 63n) ? `ordinal:${thunk & 0xffffn}` : stringAt(relative(Number(thunk)) + 2));
      }
      if (!thunkTerminated) throw new Error('Unterminated PE import lookup table');
      imports.push({ kind, dll: stringAt(dllRva), symbols });
    }
    if (!terminated) throw new Error('Unterminated PE import directory');
  }
  return { machine, subsystemVersion: [u16(optional + 48), u16(optional + 50)], imports };
}

export function validatePeForWin7(pe) {
  const issues = [];
  if (pe.machine !== 0x8664) issues.push('Expected x86_64 machine');
  const [major, minor] = pe.subsystemVersion;
  if (major > 6 || (major === 6 && minor > 1)) issues.push(`Subsystem ${major}.${minor} exceeds Windows 7 (6.1)`);
  for (const entry of pe.imports) {
    if (unsupportedDll.test(entry.dll)) issues.push(`${entry.kind}: unsupported DLL ${entry.dll}`);
    for (const symbol of entry.symbols) {
      if (unsupportedFunctions.has(symbol)) issues.push(`${entry.kind}: unsupported API ${entry.dll}!${symbol}`);
    }
  }
  return issues;
}

function binaryPaths(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in installer: ${full}`);
    return entry.isDirectory() ? binaryPaths(full) : (/\.(?:exe|dll)$/i.test(entry.name) ? [full] : []);
  });
}

export function checkInstalledBinaries({ directory, executable, reportPath }) {
  const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const sourceHash = sha256(fs.readFileSync(executable));
  const paths = binaryPaths(directory);
  if (!paths.length) throw new Error('MSI extraction contains no EXE/DLL');
  const files = paths.map((file) => {
    const data = fs.readFileSync(file);
    const pe = readPeImports(data);
    return { path: path.relative(directory, file), sha256: sha256(data), ...pe, issues: validatePeForWin7(pe) };
  });
  const main = files.filter((file) => path.basename(file.path).toLowerCase() === 'pcie.exe');
  const issues = files.flatMap((file) => file.issues.map((issue) => `${file.path}: ${issue}`));
  if (main.length !== 1 || main[0].sha256 !== sourceHash) issues.push('Installed pcie.exe does not uniquely match this build SHA-256');
  const report = {
    passed: issues.length === 0, sourceExecutableSha256: sourceHash, files, issues,
    scope: 'Known incompatible static/delay imports only; real Win7 SP1 x64 smoke test remains required',
    prerequisites: ['External WebView2 109', 'Universal CRT (applicable KB2999226 or superseding update)'],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (issues.length) throw new Error(`Win7 PE import gate failed:\n${issues.join('\n')}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = { '--directory': 'directory', '--executable': 'executable', '--report': 'reportPath' }[process.argv[i]];
      if (!key || !process.argv[i + 1]) throw new Error('Usage: --directory extracted-msi --executable built-pcie.exe --report report.json');
      options[key] = path.resolve(process.argv[i + 1]);
    }
    if (!options.directory || !options.executable || !options.reportPath) throw new Error('All three paths are required');
    const report = checkInstalledBinaries(options);
    console.log(`Win7 installed PE gate passed: ${report.files.length} files; pcie.exe SHA-256 ${report.sourceExecutableSha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
