// TEST ONLY. Render evidence, not process-alive or fixture-callback readiness.
export const productReadyText = 'Proceed harness ready for qualification (owner shared).';
export function compositionRenderEvidence(text) {
  return {
    hostFrameSeen: text.includes('2.2.5'),
    productReadySeen: text.includes(productReadyText),
    pickerTitleSeen: text.includes('Select the Proceed session'),
    emptyResultSeen: text.includes('selected session has no pending question'),
  };
}

// Pinned public Context.keymap.commands lists reachable commands. The fixture
// separately checks active keys. Neither observation invokes a command callback.
export async function awaitCompositionRender({ observe, pause, now, deadline, record }) {
  while (now() < deadline) {
    const state = await observe();
    record({
      ...state.rendered,
      commandEligible: state.commandEligible === true,
    });
    if (state.exited) throw Object.assign(new Error('host exited'), { code: 'HOST_EXITED' });
    if (state.overflow)
      throw Object.assign(new Error('capture limit'), {
        code: 'CAPTURE_LIMIT',
      });
    if (
      state.rendered.hostFrameSeen &&
      state.rendered.productReadySeen &&
      state.commandEligible === true
    )
      return;
    await pause();
  }
  throw Object.assign(new Error('render readiness deadline'), {
    code: 'READINESS_DEADLINE',
  });
}

export function compositionErrorCode(error) {
  return [
    'HOST_EXITED',
    'CAPTURE_LIMIT',
    'READINESS_DEADLINE',
    'ERR_ASSERTION',
    'ENOENT',
    'EACCES',
    'ETIMEDOUT',
  ].includes(error?.code)
    ? error.code
    : 'CONTROL_ASSERTION_OR_IO';
}
