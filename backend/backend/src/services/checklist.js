import { Checklist } from '../models/Checklist.js';
import { DocumentModel } from '../models/Document.js';
import { notFound } from '../errors.js';

export async function loadChecklist(category) {
  const c = await Checklist.findOne({ category }).lean();
  if (!c) throw notFound(`No checklist configured for category "${category}"`);
  return c;
}

export async function activeDocuments(applicationId) {
  return DocumentModel.find({ application: applicationId, active: true }).sort({ createdAt: 1 });
}

export function checklistProgress(checklist, docs) {
  const uploaded = new Set(docs.filter((d) => d.kind === 'checklist').map((d) => d.key));
  const required = checklist.documents.filter((d) => d.required);
  const missing = required.filter((d) => !uploaded.has(d.key));
  const done = required.length - missing.length;
  return {
    requiredTotal: required.length,
    requiredUploaded: done,
    percent: required.length ? Math.round((done / required.length) * 100) : 100,
    missing: missing.map((d) => ({ key: d.key, label: d.label })),
    items: checklist.documents.map((d) => {
      const doc = docs.find((x) => x.kind === 'checklist' && x.key === d.key);
      return { ...d, status: doc ? 'uploaded' : 'missing', documentId: doc?._id, filename: doc?.filename };
    }),
    infrastructure: checklist.infrastructure.map((i) => {
      const doc = docs.find((x) => x.kind === 'infrastructure' && x.key === i.key);
      return { ...i, status: doc ? 'added' : 'not_added', documentId: doc?._id, filename: doc?.filename };
    }),
  };
}
