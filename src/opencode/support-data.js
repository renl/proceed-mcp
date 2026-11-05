// Production-owned release support data for OpenCode V2 hosts (design
// section 6). A host version enters this list only after the external,
// test-owned host-boundary spike has completed the section 7 matrix and its
// evidence record has been reviewed and promoted here with its applicability
// references. Entries are exact `ServerInfo.version` values: there is no
// range, wildcard, SDK-derived, guessed or runtime-configurable form, and
// observing a host never writes to this list. An empty list is valid and
// admits no host; every unlisted version fails closed as UNSUPPORTED_HOST.
export const REVIEWED_HOSTS = Object.freeze([
  // No host has completed the boundary matrix yet, so this release admits
  // none. Promotion adds Object.freeze({ version: '<exact ServerInfo.version>',
  // evidence: '<reviewed host-proof record>' }) after evidence review.
]);

export function isReviewedHostVersion(version) {
  return typeof version === 'string' && REVIEWED_HOSTS.some((host) => host.version === version);
}
