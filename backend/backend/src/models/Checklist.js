import mongoose from 'mongoose';

const docRule = new mongoose.Schema(
  {
    key: { type: String, required: true }, // affidavit, noc, fire_certificate ...
    label: { type: String, required: true },
    description: String,
    required: { type: Boolean, default: true },
    rule: String, // human readable, shown on the admin screen
    mustBeValidOnSubmission: { type: Boolean, default: false },
    requiredFields: { type: [String], default: [] }, // fields that must be extracted, else "incomplete"
    referencePattern: String, // optional regex string for the reference number format
  },
  { _id: false }
);

const infraRule = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    requirement: { type: String, required: true }, // text sent to the vision model
  },
  { _id: false }
);

const checklistSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
    documents: [docRule],
    infrastructure: [infraRule],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const Checklist = mongoose.model('Checklist', checklistSchema);
