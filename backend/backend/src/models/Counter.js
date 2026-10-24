import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', counterSchema);

// APP-2026-00412 style reference, one sequence per year
export async function nextApplicationCode(date = new Date()) {
  const year = date.getFullYear();
  const c = await Counter.findOneAndUpdate({ _id: `app-${year}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `APP-${year}-${String(c.seq).padStart(5, '0')}`;
}
