// TEST ONLY. Narrow block-YAML reader, not a GitHub Actions interpreter.
import { parsers } from 'prettier/plugins/yaml';

export class WorkflowModelError extends Error {}
const fail = () => { throw new WorkflowModelError('unsupported workflow structure'); };
const map = (value) => value && !Array.isArray(value) && typeof value === 'object';
const keys = (value, allowed) => {
  if (!map(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail();
};
function decode(node) {
  if (!node) return null;
  if (node.anchor != null || node.tag != null) fail();
  if (['plain', 'blockLiteral'].includes(node.type)) return node.value;
  if (node.type === 'sequence') return node.children.map((item) => {
    if (item.type !== 'sequenceItem' || item.children.length !== 1) fail();
    return decode(item.children[0]);
  });
  if (node.type !== 'mapping') fail();
  const result = Object.create(null);
  for (const item of node.children) {
    if (item.type !== 'mappingItem' || item.children.length !== 2) fail();
    const [key, value] = item.children;
    if (key.type !== 'mappingKey' || value.type !== 'mappingValue' ||
        key.children.length !== 1 || key.children[0].type !== 'plain' || value.children.length > 1) fail();
    const name = decode(key.children[0]);
    if (name === '<<' || Object.hasOwn(result, name)) fail();
    result[name] = decode(value.children[0]);
  }
  return result;
}
const strings = (value) => {
  if (!map(value) || Object.values(value).some((entry) => typeof entry !== 'string')) fail();
  return value;
};
export function parseWorkflow(text) {
  const ast = parsers.yaml.parse(text, {});
  if (ast.children.length !== 1 || ast.children[0].type !== 'document') fail();
  const [head, body] = ast.children[0].children;
  if (head?.type !== 'documentHead' || head.children.length ||
      body?.type !== 'documentBody' || body.children.length !== 1) fail();
  const workflow = decode(body.children[0]);
  keys(workflow, ['name', 'on', 'permissions', 'jobs']);
  if (!map(workflow.on) || !map(workflow.jobs) || !Object.keys(workflow.jobs).length) fail();
  if (Object.values(workflow.on).some((value) => value !== null)) fail();
  return {
    triggers: Object.keys(workflow.on), topPermissions: strings(workflow.permissions),
    jobs: Object.entries(workflow.jobs).map(([id, job]) => {
      keys(job, ['name', 'runs-on', 'timeout-minutes', 'steps', 'permissions', 'environment', 'if']);
      if (typeof job['runs-on'] !== 'string' || !/^(?:[1-9]|1[0-5])$/.test(job['timeout-minutes']) ||
          !Array.isArray(job.steps)) fail();
      return { id, runsOn: [job['runs-on']], environment: job.environment ?? null,
        permissions: strings(job.permissions ?? {}), if: job.if ?? null,
        steps: job.steps.map((step) => {
          keys(step, ['name', 'run', 'uses', 'with', 'shell', 'timeout-minutes']);
          if ((typeof step.run === 'string') === (typeof step.uses === 'string')) fail();
          if (step.shell != null && step.shell !== 'pwsh') fail();
          if (step['timeout-minutes'] != null && !/^[1-5]$/.test(step['timeout-minutes'])) fail();
          return { run: step.run ?? null, uses: step.uses ?? null,
            with: strings(step.with ?? {}), env: {} };
        }) };
    }),
  };
}
