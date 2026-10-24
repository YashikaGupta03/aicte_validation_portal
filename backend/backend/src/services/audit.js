import crypto from 'node:crypto';
import { AuditLog } from '../models/AuditLog.js';

export const SYSTEM = { id: null, name: 'system', role: 'system' };
export const actorOf = (user) => (user ? { id: String(user._id), name: user.name, role: user.role } : SYSTEM);

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function hashEntry(e) {
  return sha256(
    stableStringify({
      seq: e.seq,
      at: new Date(e.at).toISOString(),
      actor: e.actor,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      applicationId: e.applicationId ?? null,
      details: e.details ?? null,
      prevHash: e.prevHash,
    })
  );
}

// Serialise writes inside this process; the unique index on seq plus retry covers other processes (the worker).
let chain = Promise.resolve();
export function audit(entry) {
  const run = chain.then(() => writeWithRetry(entry));
  chain = run.catch(() => {});
  return run;
}

async function writeWithRetry(entry, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await write(entry);
    } catch (err) {
      if (err?.code === 11000 && i < attempts - 1) continue; // another process took this seq
      throw err;
    }
  }
}

async function write({ actor = SYSTEM, action, entityType, entityId, applicationId, details }) {
  const last = await AuditLog.findOne().sort({ seq: -1 }).lean();
  const body = {
    seq: (last?.seq ?? 0) + 1,
    at: new Date(),
    actor,
    action,
    entityType: entityType ?? null,
    entityId: entityId != null ? String(entityId) : null,
    applicationId: applicationId != null ? String(applicationId) : null,
    details: details ? JSON.parse(JSON.stringify(details)) : null,
    prevHash: last?.hash ?? 'GENESIS',
  };
  return AuditLog.create({ ...body, hash: hashEntry(body) });
}

export async function verifyChain() {
  let prev = 'GENESIS';
  let count = 0;
  for await (const e of AuditLog.find().sort({ seq: 1 }).lean().cursor()) {
    count++;
    if (e.prevHash !== prev || hashEntry(e) !== e.hash) return { ok: false, brokenAtSeq: e.seq, checked: count };
    prev = e.hash;
  }
  return { ok: true, checked: count };
}
