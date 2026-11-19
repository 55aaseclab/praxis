import { z } from 'zod';

export const knowledgeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const collectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/);
export const knowledgeRevisionSchema = z.string().max(15).regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)), 'Revision must be a safe positive integer string.');
const text = max => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Text contains unsupported control characters.');
const title = max => text(max).refine(value => value.length > 0 && value === value.trim(), 'Text must be nonempty and trimmed.');
const unique = schema => z.array(schema).max(200).refine(value => new Set(value).size === value.length, 'Values must be unique.');
export const knowledgeCreateFields = { name: title(160), description: text(2000).optional() };
export const knowledgeCollectionFields = { id: collectionId, title: title(160), description: text(2000), entryIds: unique(knowledgeIdSchema) };
const sourceUrl = z.string().max(2048).url().refine(value => { try { const url = new URL(value); return !/[\s\\]/.test(value) && url.protocol === 'https:' && !url.username && !url.password && !url.hash; } catch { return false; } }, 'Source URL must be HTTPS without credentials or a fragment.');
export const knowledgeSourceFields = { id: knowledgeIdSchema, title: title(160), kind: z.enum(['text', 'url']), text: text(200000).refine(value => value.length > 0, 'Text must not be empty.'), url: sourceUrl.nullable().optional() };
export const knowledgeSourceSchema = z.object(knowledgeSourceFields).strict().refine(value => value.kind === 'url' ? typeof value.url === 'string' : value.url == null, 'URL sources require a URL; text sources cannot contain one.');
export const knowledgeCaptureFields = { sourceId: knowledgeIdSchema, sourceSpaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/), projectId: knowledgeIdSchema, projectRevision: knowledgeRevisionSchema };
export const knowledgeEntryFields = { id: knowledgeIdSchema, title: title(160), kind: z.enum(['note', 'method', 'conclusion']), body: text(200000).refine(value => value.length > 0, 'Text must not be empty.'), tags: unique(title(80)), sourceRefs: z.array(z.object({ sourceId: knowledgeIdSchema, locator: text(300) }).strict()).min(1).max(100).refine(value => new Set(value.map(ref => `${ref.sourceId}\0${ref.locator}`)).size === value.length, 'Source references must be unique.'), status: z.enum(['draft', 'published', 'archived']) };
export const knowledgeReadEntryFields = { entryId: knowledgeIdSchema, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() };
export const knowledgeReplaceTextFields = { entryId: knowledgeIdSchema, oldText: text(200000).refine(value => value.length > 0, 'Old text must not be empty.'), newText: text(200000) };
const fragment = text(200000).refine(value => value.trim().length > 0, 'Text must not be blank.');
export const knowledgeInsertTextFields = { entryId: knowledgeIdSchema, anchorText: fragment, text: fragment, position: z.enum(['before', 'after']) };
export const knowledgeDeleteTextFields = { entryId: knowledgeIdSchema, text: fragment };
export const knowledgeSearchFields = { query: title(100), collectionId: collectionId.optional(), limit: z.number().int().min(1).max(50).optional() };
const documentId = z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeImportFields = {
  attachmentId: documentId, filename: title(200).refine(value => !/[\/\\]/.test(value) && !['.', '..'].includes(value), 'Expected a filename.'),
  title: title(160),
};
const pageOffset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
export const knowledgeDocumentFields = {
  documentId, offset: pageOffset, limit: z.number().int().min(1).max(50).optional(),
  includeOutline: z.boolean().optional(), outlineOffset: pageOffset, outlineLimit: z.number().int().min(1).max(200).optional(),
};
export const knowledgeDocumentSchema = z.object(knowledgeDocumentFields).strict().refine(
  input => input.includeOutline || (input.outlineOffset === undefined && input.outlineLimit === undefined),
  'Outline pagination requires includeOutline.',
);
export const knowledgeEvidenceFields = { query: title(200), documentId: documentId.optional(), limit: z.number().int().min(1).max(30).optional() };
const paperStatus = z.enum(['complete', 'partial', 'pending']);
const paperCount = z.number().int().min(0).max(10_000_000);
const edition = z.object({ year: z.number().int().min(1900).max(2200), status: paperStatus, papers: paperCount, cachedPdfs: paperCount }).strict().refine(value => value.cachedPdfs <= value.papers && (value.status !== 'pending' || value.papers === 0));
const paperVenue = z.object({
  group: z.enum(['systems', 'security', 'software-engineering']),
  venueKey: z.string().max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/),
  name: title(300).refine(value => !/[\u0000-\u001f\u007f]/.test(value)), archiveStatus: paperStatus,
  editions: z.array(edition).max(200).refine(values => new Set(values.map(value => value.year)).size === values.length),
}).strict();
export const knowledgePaperFields = { snapshot: z.object({
  schemaVersion: z.literal(1), profile: z.literal('ccf-a-papers@1'), observedAt: z.string().datetime({ offset: true }),
  year: z.number().int().min(1900).max(2200).optional(),
  venues: z.array(paperVenue).min(1).max(200).refine(values => new Set(values.map(value => value.venueKey)).size === values.length),
}).strict().refine(snapshot => snapshot.year === undefined || snapshot.venues.every(venue => venue.editions.every(edition => edition.year === snapshot.year)), 'Edition falls outside snapshot year') };
export const knowledgeInputs = Object.freeze({
  list_libraries: z.object({}).strict(), read_library: z.object({}).strict(),
  create_library: z.object(knowledgeCreateFields).strict(), set_collection: z.object(knowledgeCollectionFields).strict(),
  add_source: knowledgeSourceSchema, capture_project: z.object(knowledgeCaptureFields).strict(),
  import_paper_statistics: z.object(knowledgePaperFields).strict(),
  import_document: z.object(knowledgeImportFields).strict(), read_document: knowledgeDocumentSchema,
  search_evidence: z.object(knowledgeEvidenceFields).strict(),
  read_source: z.object({ sourceId: knowledgeIdSchema }).strict(), set_entry: z.object(knowledgeEntryFields).strict(),
  read_entry: z.object(knowledgeReadEntryFields).strict(), search: z.object(knowledgeSearchFields).strict(),
  replace_document_text: z.object(knowledgeReplaceTextFields).strict(),
  insert_document_text: z.object(knowledgeInsertTextFields).strict(), delete_document_text: z.object(knowledgeDeleteTextFields).strict(),
  events: z.object({ after: z.number().int().nonnegative().optional() }).strict(),
});
