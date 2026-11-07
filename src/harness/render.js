// Portable harness enrollment copy (design section 1). Pure rendering: no I/O,
// no timestamps, no authority. Only the public fingerprint, the proposed scope
// and the broker-issued identifiers appear; the operator credential itself never
// reaches a broker state, a message or a log.

export const ENROLLMENT_CONFIRM_PREFIX = 'he';
export const ENROLLMENT_DENY_PREFIX = 'hx';

// The paired human compares this fingerprint with the genuine local setup
// display before confirming. Confirming delegates decision authority for this
// broker; it approves no work.
export function renderEnrollmentNotice({ enrollmentId, harnessId, ownerId, keyId, expiresAt }) {
  return [
    `Harness operator enrollment ${enrollmentId}`,
    '',
    `Harness: ${harnessId}`,
    `Owner: ${ownerId}`,
    `Operator key fingerprint: ${keyId}`,
    `Expires: ${expiresAt}`,
    '',
    'Compare the fingerprint above with the operator setup display.',
    "Confirming authorizes that local operator to resolve this broker's Proceed",
    'requests through the trusted harness. It does not approve any work.',
  ].join('\n');
}

export function enrollmentNoticeKeyboard({ confirmToken, denyToken }) {
  return {
    inline_keyboard: [
      [
        {
          text: 'Confirm operator key',
          callback_data: `${ENROLLMENT_CONFIRM_PREFIX}:${confirmToken}`,
        },
        { text: 'Deny', callback_data: `${ENROLLMENT_DENY_PREFIX}:${denyToken}` },
      ],
    ],
  };
}
