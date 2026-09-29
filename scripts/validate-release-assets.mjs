import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const DEFAULT_TARGETS = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[current.slice(2)] = true;
    } else {
      args[current.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

function decodeOuterSignature(signature, label) {
  try {
    return Buffer.from(signature, 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`${label} is not valid base64: ${error.message}`);
  }
}

function readKeyIdFromPublicKey(encodedPublicKey) {
  const decoded = Buffer.from(encodedPublicKey, 'base64').toString('utf8');
  const keyLine = decoded.split(/\r?\n/).find((line) => line.startsWith('RW'));
  if (!keyLine) throw new Error('configured updater public key is invalid');
  const keyBytes = Buffer.from(keyLine, 'base64');
  if (keyBytes.length < 10) throw new Error('configured updater public key is truncated');
  return keyBytes.subarray(2, 10);
}

function readKeyIdFromSignatureText(signatureText, label) {
  const signatureLine = signatureText.split(/\r?\n/).find((line) => line.startsWith('RU'));
  if (!signatureLine) throw new Error(`${label} does not contain a minisign signature`);
  const signatureBytes = Buffer.from(signatureLine, 'base64');
  if (signatureBytes.length < 10) throw new Error(`${label} minisign signature is truncated`);
  return signatureBytes.subarray(2, 10);
}

function artifactNameFromUrl(url, target) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`${target} has an invalid download URL: ${error.message}`);
  }
  return {
    name: decodeURIComponent(path.posix.basename(parsed.pathname)),
    pathSegments: parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent),
  };
}

function findUniqueFile(rootDir, fileName) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name === fileName) matches.push(entryPath);
    }
  };
  visit(rootDir);
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error(`release contains multiple files named ${fileName}`);
  return matches[0];
}

function findVersionedReleaseFile(rootDir, fileName, tag) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name === fileName) matches.push(entryPath);
    }
  };
  visit(rootDir);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const versionedMatches = matches.filter((match) =>
    path.relative(rootDir, match).split(path.sep).includes(tag),
  );
  if (versionedMatches.length === 1) return versionedMatches[0];
  throw new Error(`release contains multiple files named ${fileName}`);
}

function verifyWithMinisign({ command, artifactPath, signatureText, publicKeyText }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-release-signature-'));
  const signaturePath = path.join(tempDir, 'artifact.minisig');
  const publicKeyPath = path.join(tempDir, 'updater.pub');
  try {
    fs.writeFileSync(signaturePath, signatureText);
    fs.writeFileSync(publicKeyPath, publicKeyText);
    const result = spawnSync(command, ['-Vm', artifactPath, '-p', publicKeyPath, '-x', signaturePath], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `minisign verification failed for ${path.basename(artifactPath)}: ${(result.stderr || result.stdout).trim()}`,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function validateReleaseAssets({
  assetsDir,
  tag,
  publicKey,
  requiredTargets = DEFAULT_TARGETS,
  minisignCommand,
}) {
  const latestPath = findUniqueFile(assetsDir, 'latest.json');
  if (!latestPath) throw new Error('release is missing latest.json');
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const expectedVersion = tag?.replace(/^v/, '');
  if (!expectedVersion || latest.version !== expectedVersion) {
    throw new Error(`latest.json version ${latest.version} does not match release ${tag}`);
  }

  const publicKeyId = readKeyIdFromPublicKey(publicKey);
  const publicKeyText = Buffer.from(publicKey, 'base64').toString('utf8');
  const verifiedArtifacts = new Set();

  for (const target of requiredTargets) {
    const platform = latest.platforms?.[target];
    if (!platform) throw new Error(`latest.json is missing required target ${target}`);
    if (!platform.signature) throw new Error(`${target} is missing its signature`);

    const artifactUrl = artifactNameFromUrl(platform.url, target);
    const artifactName = artifactUrl.name;
    if (!artifactUrl.pathSegments.includes(tag)) {
      throw new Error(`${target} URL does not contain release version ${tag}: ${platform.url}`);
    }
    const artifactPath = findVersionedReleaseFile(assetsDir, artifactName, tag);
    const signaturePath = findVersionedReleaseFile(assetsDir, `${artifactName}.sig`, tag);
    if (!artifactPath) throw new Error(`${target} artifact is missing: ${artifactName}`);
    if (!signaturePath) throw new Error(`${target} signature asset is missing: ${artifactName}.sig`);

    const signatureAsset = fs.readFileSync(signaturePath, 'utf8').trim();
    if (signatureAsset !== platform.signature.trim()) {
      throw new Error(`${target} latest.json signature does not match ${artifactName}.sig`);
    }
    const signatureText = decodeOuterSignature(signatureAsset, `${artifactName}.sig`);
    const signatureKeyId = readKeyIdFromSignatureText(signatureText, `${artifactName}.sig`);
    if (!signatureKeyId.equals(publicKeyId)) {
      throw new Error(`${artifactName}.sig was generated by a different updater key`);
    }

    if (minisignCommand && !verifiedArtifacts.has(artifactName)) {
      verifyWithMinisign({ command: minisignCommand, artifactPath, signatureText, publicKeyText });
    }
    verifiedArtifacts.add(artifactName);
  }

  return { version: latest.version, targets: requiredTargets, artifacts: [...verifiedArtifacts] };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args['assets-dir'] || !args.tag || !args['tauri-config']) {
      throw new Error('--assets-dir, --tag and --tauri-config are required');
    }
    const tauriConfig = JSON.parse(fs.readFileSync(path.resolve(args['tauri-config']), 'utf8'));
    const result = validateReleaseAssets({
      assetsDir: path.resolve(args['assets-dir']),
      tag: args.tag,
      publicKey: tauriConfig.plugins?.updater?.pubkey,
      requiredTargets: args.targets ? args.targets.split(',').filter(Boolean) : DEFAULT_TARGETS,
      minisignCommand: args.minisign,
    });
    console.log(
      `Release assets passed for ${result.version}: ${result.targets.join(', ')}; ${result.artifacts.join(', ')}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
