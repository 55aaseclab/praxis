import { stat } from 'node:fs/promises';
import { z } from 'zod';

// The owning app supplies the validation contract when it is installed.
const moduleUrl = new URL('../../third_party/lattice/src/business/schema.mjs', import.meta.url);
const installed = await stat(moduleUrl).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const schema = installed ? await import(moduleUrl.href) : null;

export const slidesAvailable = Boolean(schema);
export const SLIDES_OPERATIONS = schema?.OPERATIONS ?? {};
export const slidesInputs = schema?.inputs;
export const SLIDES_NO_RESOURCE = schema?.NO_RESOURCE;
export const SLIDES_DOCUMENT_WRITES = schema?.DOCUMENT_WRITES;
export const SLIDES_KEYED_OPERATIONS = schema?.KEYED_OPERATIONS;
export const SLIDES_SNAPSHOT_OPERATIONS = schema?.SNAPSHOT_OPERATIONS;
export const slidesIdSchema = schema?.idSchema;
export const slidesRevisionSchema = schema?.revisionSchema;

export const SLIDES_ACTIONS = Object.freeze(['read', 'create', 'update', 'render', 'export', 'delete', 'notes', 'manage_lock']);
const errorSegment = z.union([z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/).refine(value => !['__proto__','prototype','constructor'].includes(value)), z.number().int().min(0).max(1000000)]);
const fieldError = z.object({ path: z.array(errorSegment).min(1).max(24), code: z.enum(Object.values(z.ZodIssueCode)) }).strict();

export function slidesErrorDetails(status, code, value) {
  if (status === 409 && code === 'REVISION_CONFLICT' && /^[1-9][0-9]{0,14}$/.test(value?.currentRevision || '') && typeof value.currentRevision === 'string') return { currentRevision: value.currentRevision };
  if (status !== 400 || code !== 'INVALID_INPUT' || !Array.isArray(value?.fieldErrors)) return {};
  const fieldErrors = value.fieldErrors.slice(0,20).flatMap(item => {
    const result = fieldError.safeParse({ path: item?.path, code: item?.code });
    return result.success ? [result.data] : [];
  });
  return fieldErrors.length ? { fieldErrors } : {};
}

export function slidesRequiredActions(operation, input = {}) {
  const actions = new Set();
  if (!['create_deck', 'get_capabilities', 'get_media_catalog', 'get_template'].includes(operation)) actions.add('read');
  if (['preview', 'lint', 'prepare_audio', 'render_video', 'review'].includes(operation) || operation === 'check' && input.rendered !== false) actions.add('render');
  if (['export', 'render_video'].includes(operation)) actions.add('export');
  if (['review', 'budget'].includes(operation) || operation === 'prepare_audio' && input.kind === 'narration' || operation === 'render_video' && input.operation === 'subtitles') actions.add('notes');
  if (input.includeNotes === true || operation === 'get_links' && input.view === 'presenter') actions.add('notes');
  if (operation === 'apply_edits' && input.operations?.some(edit => edit.kind === 'reset_template' || edit.kind === 'set_notes' || edit.kind === 'add_slide' && edit.slide?.notes)) actions.add('notes');
  return [...actions];
}
