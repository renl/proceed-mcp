// Release-policy schema leaf: the selected identity constants, the single error
// class, the tarball-name function and the record-shape primitives the other
// leaves share. No filesystem, child process, environment or clock read, network
// access or top-level execution lives here. Consumers import these bindings
// instead of redeclaring them, so one ReleasePolicyError identity stays catchable.
// The primitives are implementation-owned helpers and are not facade exports.
export const RELEASE_POLICY_SCHEMA_VERSION = 2;
export const PACKED_INPUT_DIGEST_ALGORITHM = 'sha256-packed-inputs-v1';
export const VERSION_PATTERN = /^\d+\.\d+\.\d+-preview\.\d+$/;

// Selected release identity. Agreement with these values is a consistency check
// only: it never authorizes publication or proves a native GitHub or npm control.
export const APPROVED = Object.freeze({
  repository: 'renl/proceed-mcp',
  packageName: '@meshimize/proceed-mcp',
  registryName: 'io.github.renl/proceed-mcp',
  channel: 'preview',
  environment: 'npm-preview',
  workflow: '.github/workflows/release.yml',
  bootstrapVersion: '0.1.0-preview.1',
});

export class ReleasePolicyError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ReleasePolicyError';
    this.code = code;
  }
}

export const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isText = (value) => typeof value === 'string' && value.length > 0;

// Repo-relative durable reference: no drive letter, leading slash, backslash or
// traversal segment. Shared by both record schemas.
export const isRepoRelative = (value) => {
  if (!isText(value) || value.includes('\\') || value.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
};

// '<scope-name>-<version>.tgz': the leading '@' is dropped and '/' becomes '-'.
export function expectedTarballName(name, version) {
  if (!isText(name) || !isText(version)) {
    throw new ReleasePolicyError('USAGE_INVALID', 'expectedTarballName needs a name and version');
  }
  return `${name.replace(/^@/, '').split('/').join('-')}-${version}.tgz`;
}
