import mongoose from 'mongoose';

export const VERIFICATION_STATUSES = ['verified', 'mismatch', 'expired', 'pending', 'source_unavailable', 'manual_review'];
// Most urgent first. Used for the "most urgent status per application" chart.
export const VERIFICATION_URGENCY = ['mismatch', 'expired', 'source_unavailable', 'manual_review', 'pending', 'verified'];

const verificationSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    run: { type: Number, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    documentKey: String,
    status: { type: String, enum: VERIFICATION_STATUSES, required: true },
    source: String,
    checkedAt: { type: Date, default: Date.now },
    details: mongoose.Schema.Types.Mixed, // what was compared, QR / signature findings, reason
  },
  { timestamps: true }
);

export const Verification = mongoose.model('Verification', verificationSchema);
