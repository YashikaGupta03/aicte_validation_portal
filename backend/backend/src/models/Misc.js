import mongoose from 'mongoose';

// Mock issuing authorities (NAAC, NBA, ...). Real integrations would replace these two collections.
const sourceSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  name: String,
  available: { type: Boolean, default: true }, // admin can switch off to demo "source_unavailable"
});
export const Source = mongoose.model('Source', sourceSchema);

const sourceRecordSchema = new mongoose.Schema({
  source: { type: String, required: true, index: true },
  ref: { type: String, required: true },
  data: mongoose.Schema.Types.Mixed,
});
sourceRecordSchema.index({ source: 1, ref: 1 }, { unique: true });
export const SourceRecord = mongoose.model('SourceRecord', sourceRecordSchema);

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    title: String,
    body: String,
    readAt: Date,
  },
  { timestamps: true }
);
export const Notification = mongoose.model('Notification', notificationSchema);
