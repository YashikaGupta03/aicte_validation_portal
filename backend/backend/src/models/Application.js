import mongoose from 'mongoose';

export const STATUSES = [
  'draft',
  'submitted',
  'ai_running',
  'ai_failed',
  'ready_for_review',
  'under_review',
  'more_info_requested',
  'approved',
  'rejected',
];
export const DECIDED = ['approved', 'rejected'];

const applicationSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, sparse: true }, // assigned on submit
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, required: true, default: 'Extension of Approval' },
    status: { type: String, enum: STATUSES, default: 'draft', index: true },
    form: {
      institutionName: { type: String, default: '' },
      academicYear: { type: String, default: '' },
      address: { type: String, default: '' },
      proposedIntake: { type: Number, min: 0 },
      previousApprovalRef: { type: String, default: '' },
    },
    submittedAt: Date,
    analysisRun: { type: Number, default: 0 }, // incremented on every (re)submission or re-analysis
    progress: {
      done: { type: Number, default: 0 },
      total: { type: Number, default: 5 },
      stage: { type: String, default: '' },
    },
    missingDocuments: { type: [String], default: [] },
    assignedOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    infoRequest: { message: String, requestedAt: Date, requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
    decision: {
      outcome: { type: String, enum: ['approve', 'reject', 'request_info'] },
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    analysisError: String,
  },
  { timestamps: true }
);

export const Application = mongoose.model('Application', applicationSchema);
