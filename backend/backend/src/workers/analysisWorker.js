import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { redisConnection, QUEUE_NAME } from '../queue.js';
import { Application } from '../models/Application.js';
import { DocumentModel } from '../models/Document.js';
import { Flag } from '../models/Flag.js';
import { Verification } from '../models/Verification.js';
import { InfraResult } from '../models/InfraResult.js';
import { loadChecklist, activeDocuments } from '../services/checklist.js';
import { callAnalyze } from '../services/aiClient.js';
import { audit, SYSTEM } from '../services/audit.js';
import { notifyOfficers, notifyUser } from '../services/notify.js';
import { seedDefaults } from '../seed/data.js';

const SEVERITIES = ['low', 'medium', 'high'];

export async function processAnalysis(job) {
  const { applicationId, run } = job.data;
  const app = await Application.findById(applicationId);
  if (!app || app.analysisRun !== run) return { skipped: 'stale job' };

  app.status = 'ai_running';
  app.progress = { done: 0, total: 5, stage: 'starting' };
  await app.save();

  const [checklist, docs] = await Promise.all([loadChecklist(app.category), activeDocuments(app._id)]);
  const payload = {
    application_id: String(app._id),
    application_code: app.code,
    run,
    category: app.category,
    submission_date: (app.submittedAt ?? new Date()).toISOString().slice(0, 10),
    form: {
      institution_name: app.form.institutionName,
      academic_year: app.form.academicYear,
      address: app.form.address,
      proposed_intake: app.form.proposedIntake,
      previous_approval_ref: app.form.previousApprovalRef,
    },
    checklist: {
      version: checklist.version,
      documents: checklist.documents.map((d) => ({
        key: d.key, label: d.label, required: d.required, must_be_valid_on_submission: d.mustBeValidOnSubmission,
        required_fields: d.requiredFields, reference_pattern: d.referencePattern ?? null,
      })),
      infrastructure: checklist.infrastructure.map((i) => ({ key: i.key, label: i.label, requirement: i.requirement })),
    },
    documents: docs.map((d) => ({
      id: String(d._id), kind: d.kind, key: d.key, filename: d.filename, mime: d.mime, sha256: d.sha256,
      download_url: `${config.publicApiUrl}/internal/files/${d._id}`,
    })),
    callback: { progress_url: `${config.publicApiUrl}/internal/applications/${app._id}/progress` },
  };

  const result = await callAnalyze(payload);

  // A newer submission may have started while the AI service was working
  const fresh = await Application.findById(app._id);
  if (!fresh || fresh.analysisRun !== run) return { skipped: 'superseded' };

  // Retries must not duplicate results
  await Promise.all([Flag.deleteMany({ application: app._id, run }), Verification.deleteMany({ application: app._id, run }), InfraResult.deleteMany({ application: app._id, run })]);

  const docById = new Map(docs.map((d) => [String(d._id), d]));
  for (const ex of result.documents ?? []) {
    const doc = docById.get(ex.doc_id);
    if (!doc) continue;
    doc.extracted = { docType: ex.doc_type, confidence: ex.confidence, ocrEngine: ex.ocr_engine, pageCount: ex.page_count, fields: ex.fields };
    if (ex.phash) doc.phash = ex.phash;
    await doc.save();
  }

  const flags = (result.flags ?? []).map((f) => ({
    application: app._id, run, stage: f.stage,
    document: docById.has(f.doc_id) ? f.doc_id : undefined,
    type: f.type, severity: SEVERITIES.includes(f.severity) ? f.severity : 'medium', reason: f.reason,
    evidence: f.evidence ?? {}, confidence: f.confidence,
    needsHumanReview: true, // advisory only, by design
  }));
  if (flags.length) await Flag.insertMany(flags);

  const verifications = (result.verifications ?? []).map((v) => ({
    application: app._id, run, document: docById.has(v.doc_id) ? v.doc_id : undefined, documentKey: v.document_key,
    status: v.status, source: v.source, checkedAt: v.checked_at ? new Date(v.checked_at) : new Date(), details: v.details,
  }));
  if (verifications.length) await Verification.insertMany(verifications);

  const infra = (result.infrastructure ?? []).map((i) => ({
    application: app._id, run, document: docById.has(i.doc_id) ? i.doc_id : undefined, requirementKey: i.requirement_key,
    requirement: i.requirement, visible: i.visible, appearsToMeet: i.appears_to_meet, result: i.result, confidence: i.confidence,
  }));
  if (infra.length) await InfraResult.insertMany(infra);

  // Every verification is audited with source, timestamp and outcome (workflow section 5)
  for (const v of verifications) {
    await audit({ actor: SYSTEM, action: 'verification.checked', entityType: 'document', entityId: v.document, applicationId: app._id, details: { documentKey: v.documentKey, source: v.source, status: v.status, checkedAt: v.checkedAt } });
  }
  const high = flags.filter((f) => f.severity === 'high').length;
  await audit({
    actor: SYSTEM, action: 'ai.analysis_completed', entityType: 'application', entityId: app._id, applicationId: app._id,
    details: { run, checklistVersion: checklist.version, flags: flags.length, highSeverity: high, verifications: verifications.length, ruleset: result.ruleset ?? null },
  });

  fresh.status = 'ready_for_review';
  fresh.progress = { done: 5, total: 5, stage: 'complete' };
  await fresh.save();

  await notifyOfficers({
    title: `${fresh.code} is ready for review`,
    body: `${fresh.form.institutionName}: automated checks finished with ${flags.length} flag(s), ${high} high severity. Review every flag before deciding.`,
    applicationId: fresh._id,
  });
  return { flags: flags.length, verifications: verifications.length };
}

export function startWorker() {
  const worker = new Worker(QUEUE_NAME, processAnalysis, { connection: redisConnection(), concurrency: 2 });
  worker.on('failed', async (job, err) => {
    console.error(`Analysis job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return; // will be retried
    const app = await Application.findById(job.data.applicationId);
    if (!app || app.analysisRun !== job.data.run) return;
    app.status = 'ai_failed';
    app.analysisError = String(err.message).slice(0, 300);
    await app.save();
    await audit({ actor: SYSTEM, action: 'ai.analysis_failed', entityType: 'application', entityId: app._id, applicationId: app._id, details: { run: job.data.run, error: app.analysisError } });
    await notifyUser(app.owner, { title: `Checks delayed for ${app.code}`, body: 'Automated checks could not finish. An officer has been informed.', applicationId: app._id });
    await notifyOfficers({ title: `AI checks failed for ${app.code}`, body: app.analysisError, applicationId: app._id });
  });
  console.log('Analysis worker started');
  return worker;
}

// `npm run worker` starts it standalone
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDb();
  await seedDefaults();
  startWorker();
  process.on('SIGTERM', async () => { await mongoose.disconnect(); process.exit(0); });
}
