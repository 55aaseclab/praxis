import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_TOOLS, MCP_CONTROL_TOOLS } from '../src/business/mcp.mjs';
import { PUBLIC_GUIDANCE_TOOLS } from '../src/public-mcp-registry.mjs';
import { assertMcpSkillCoverage, skillForTool, skillsForTools } from '../src/business/mcp-skills.mjs';

test('every registered MCP tool has a real skill with its operation guide; new unregistered tools fail closed', () => {
  const tools = [...BUSINESS_TOOLS, ...MCP_CONTROL_TOOLS, ...PUBLIC_GUIDANCE_TOOLS];
  assertMcpSkillCoverage(tools);
  const skills = skillsForTools(tools);
  const groups = new Set(BUSINESS_TOOLS.map(tool => tool.appId));
  assert.ok(groups.has('knowledge'));
  assert.equal(skills.length, groups.size + 2); // Plus public guidance and control.
  assert.equal(new Set(skills.flatMap(skill => skill.tools)).size, tools.length);
  for (const skill of skills) {
    assert.match(skill.content, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/);
    const split = skill.content.search(/\n#{1,2} [^\n]*\p{Script=Han}/u);
    assert.ok(split > 0, `Missing Chinese edition of ${skill.name}`);
    const english = skill.content.slice(0, split), chinese = skill.content.slice(split);
    for (const name of skill.tools) {
      assert.ok(english.includes('`' + name + '`'), `Missing English operation: ${name}`);
      assert.ok(chinese.includes('`' + name + '`'), `Missing Chinese operation: ${name}`);
    }
    assert.equal(skill.mimeType, 'text/markdown');
    assert.ok(skill.uri.startsWith('praxis://skills/'));
  }
  assert.throws(() => skillForTool({ name: 'unregistered_tool', appId: 'unknown-app' }), /No MCP skill/);
  assert.throws(() => skillForTool({ name: 'knowledge_undocumented_mutation', appId: 'knowledge' }), /no operation guide/);
});
