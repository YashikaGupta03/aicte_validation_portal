import { Checklist } from '../models/Checklist.js';
import { Source, SourceRecord } from '../models/Misc.js';

export const DEFAULT_CHECKLIST = {
  category: 'Extension of Approval',
  version: 1,
  documents: [
    { key: 'affidavit', label: 'Affidavit', description: 'Notarised, on stamp paper', required: true, rule: 'Notarised, on stamp paper', requiredFields: ['institution_name', 'issue_date'] },
    { key: 'noc', label: 'No Objection Certificate (NOC)', description: 'From the affiliating university', required: true, rule: 'Issued by the affiliating university', requiredFields: ['institution_name', 'issue_date', 'reference_number'] },
    { key: 'fire_certificate', label: 'Fire safety certificate', description: 'Must be valid on the submission date', required: true, rule: 'Valid on submission date', mustBeValidOnSubmission: true, requiredFields: ['institution_name', 'issue_date', 'expiry_date', 'reference_number'] },
    { key: 'accreditation', label: 'Accreditation certificate', description: 'NAAC or NBA, where applicable', required: true, rule: 'NAAC or NBA, where applicable', mustBeValidOnSubmission: true, requiredFields: ['institution_name', 'expiry_date', 'reference_number'] },
    { key: 'ter_receipt', label: 'TER payment receipt', description: 'Latest Training and Education Registration receipt', required: true, rule: 'Latest receipt', requiredFields: ['institution_name', 'issue_date', 'reference_number'] },
    { key: 'land_record', label: 'Land ownership record', description: 'Title deed or lease agreement', required: true, rule: 'Title deed or lease agreement', requiredFields: ['institution_name', 'address'] },
    { key: 'structural_certificate', label: 'Structural safety certificate', description: 'Issued by a licensed engineer', required: true, rule: 'Issued by a licensed engineer', requiredFields: ['institution_name', 'issue_date'] },
  ],
  infrastructure: [
    { key: 'computer_lab', label: 'Computer lab', requirement: 'The computer lab should show at least 60 workstations.' },
    { key: 'library', label: 'Library', requirement: 'Reading area and book stacks should be visible.' },
    { key: 'floor_plan', label: 'Campus floor plan', requirement: 'The plan should show all floors with room labels.' },
  ],
};

export const DEFAULT_SOURCES = [
  { key: 'naac', name: 'NAAC mock source' },
  { key: 'nba', name: 'NBA mock source' },
  { key: 'aicte', name: 'AICTE records mock source' },
  { key: 'university', name: 'University NOC mock source' },
  { key: 'fire', name: 'Fire department mock source' },
];

// A few fake records, matching the demo applications. Not real data.
export const DEFAULT_RECORDS = [
  { source: 'naac', ref: 'NAAC/2023/A-4521', data: { institution: 'Greenfield Institute of Technology', grade: 'A', validFrom: '2023-03-01', validTo: '2028-02-28' } },
  { source: 'nba', ref: 'NBA/ACC/2022/0873', data: { institution: 'Lakeview College of Engineering', programmes: 3, validFrom: '2022-07-01', validTo: '2025-06-30' } },
  { source: 'aicte', ref: 'AICTE/APR/2025/0412', data: { institution: 'Greenfield Institute of Technology', approvedIntake: 180, terStatus: 'paid', terLastPaid: '2026-04-12', validFrom: '2025-07-01', validTo: '2027-06-30' } },
  { source: 'aicte', ref: 'AICTE/APR/2025/0377', data: { institution: 'Meridian Engineering College', approvedIntake: 120, terStatus: 'unpaid', validFrom: '2025-07-01', validTo: '2026-06-30' } },
  { source: 'university', ref: 'UNI/NOC/2026/118', data: { institution: 'Greenfield Institute of Technology', validFrom: '2026-02-10', validTo: '2027-02-09' } },
  { source: 'fire', ref: 'FIRE/2026/GF-0192', data: { institution: 'Greenfield Institute of Technology', validFrom: '2026-01-15', validTo: '2027-01-14' } },
  { source: 'fire', ref: 'FIRE/2025/RV-0077', data: { institution: 'Riverside Polytechnic', status: 'pending', validFrom: '2025-12-01', validTo: '2026-11-30' } },
];

// Idempotent: only inserts what is missing, never overwrites admin changes.
export async function seedDefaults() {
  await Checklist.updateOne({ category: DEFAULT_CHECKLIST.category }, { $setOnInsert: DEFAULT_CHECKLIST }, { upsert: true });
  for (const s of DEFAULT_SOURCES) await Source.updateOne({ key: s.key }, { $setOnInsert: { ...s, available: true } }, { upsert: true });
}

export async function seedMockRecords() {
  for (const r of DEFAULT_RECORDS) await SourceRecord.updateOne({ source: r.source, ref: r.ref }, { $setOnInsert: r }, { upsert: true });
}
