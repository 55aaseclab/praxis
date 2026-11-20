import { readFileSync } from 'node:fs';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';

const definitions = Object.freeze({
  control: { name: 'mcp-control', path: '../../skills/mcp-control/SKILL.md' },
  public: { name: 'mcp-public', path: '../../skills/mcp-public/SKILL.md' },
});
const control = new Set(['praxis_refresh_capabilities']);
const publicTools = new Set(['praxis_about', 'praxis_use_guide']);
const loaded = new Map();
function groupFor(tool, registry) {
  const group = tool.appId || (control.has(tool.name) ? 'control' : publicTools.has(tool.name) ? 'public' : null);
  if (!group || !registry.skills[group] && !Object.hasOwn(definitions, group)) throw new Error(`No MCP skill is registered for tool: ${tool.name}`);
  return group;
}
function loadSkill(group, registry) {
  if (registry.skills[group]) return registry.skills[group];
  if (!loaded.has(group)) {
    const definition = definitions[group], content = readFileSync(new URL(definition.path, import.meta.url), 'utf8');
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    const name = header?.[1].match(/^name:\s*([^\r\n]+)$/m)?.[1].trim(), description = header?.[1].match(/^description:\s*([^\r\n]+)$/m)?.[1].trim();
    if (name !== definition.name || !description || Buffer.byteLength(content) > 128 * 1024) throw new Error(`The MCP skill is invalid: ${group}`);
    loaded.set(group, Object.freeze({ name, uri: `praxis://skills/${group}`, description, mimeType: 'text/markdown', content }));
  }
  return loaded.get(group);
}
export function skillForTool(tool, registry = DEFAULT_APP_REGISTRY) {
  const skill = loadSkill(groupFor(tool, registry), registry);
  if (!skill.content.includes('`' + tool.name + '`')) throw new Error(`The MCP skill has no operation guide for tool: ${tool.name}`);
  const { content, ...metadata } = skill; return metadata;
}
export function assertMcpSkillCoverage(tools, registry = DEFAULT_APP_REGISTRY) { for (const tool of tools) skillForTool(tool, registry); }
export function skillsForTools(tools, registry = DEFAULT_APP_REGISTRY) {
  const groups = new Map();
  for (const tool of tools) {
    const metadata = skillForTool(tool, registry), group = groupFor(tool, registry);
    if (!groups.has(metadata.uri)) groups.set(metadata.uri, { ...loadSkill(group, registry), tools: [] });
    groups.get(metadata.uri).tools.push(tool.name);
  }
  return [...groups.values()];
}
export function registerMcpSkills(server, tools, currentTools = () => tools, registry = DEFAULT_APP_REGISTRY) {
  for (const skill of skillsForTools(tools, registry)) server.registerResource(skill.name, skill.uri, { title: skill.name, description: skill.description, mimeType: skill.mimeType }, async uri => {
    let allowed; try { allowed = skillsForTools(currentTools(), registry).find(value => value.uri === skill.uri); } catch { throw new McpError(ErrorCode.InvalidParams, 'Skill is unavailable.'); }
    if (!allowed || uri.href !== skill.uri) throw new McpError(ErrorCode.InvalidParams, 'Skill is unavailable.');
    return { contents: [{ uri: skill.uri, mimeType: skill.mimeType, text: allowed.content }] };
  });
}
