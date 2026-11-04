// TEST ONLY: design3/5 structural privacy, not a new public schema or redactor.
import assert from 'node:assert/strict';

export const privateFields = new Set(['request_capability', 'registration_secret', 'pairing_snapshot',
  'user_id', 'chat_id', 'paired_at', 'update_id', 'source', 'callback_token',
  'callback_query_id', 'message_id', 'reply_prompt_id', 'response_opened', 'last_update_id', 'opened_at']);

// Accepted action/context/response strings may deliberately quote these names.
export function publicOnly(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, member] of Object.entries(value)) {
    assert.ok(!privateFields.has(key), `private structural field ${key}`);
    publicOnly(member);
  }
}
