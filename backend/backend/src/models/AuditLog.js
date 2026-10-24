import mongoose from 'mongoose';

// Append-only, hash-chained. Each entry stores the hash of the previous one, so any edit or
// deletion breaks the chain and shows up in GET /api/admin/audit/verify.
const auditSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true, unique: true },
    at: { type: Date, required: true },
    actor: { id: String, name: String, role: String },
    action: { type: String, required: true },
    entityType: String,
    entityId: String,
    applicationId: { type: String, index: true },
    details: mongoose.Schema.Types.Mixed,
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: false, versionKey: false }
);

const blocked = function () {
  throw new Error('Audit log is append-only');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  auditSchema.pre(op, blocked);
}
auditSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit log is append-only'));
  next();
});

export const AuditLog = mongoose.model('AuditLog', auditSchema);
