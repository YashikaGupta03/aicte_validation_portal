const TONES = {
  verified: ['gr', 'Verified'], ok: ['gr', 'OK'],
  mismatch: ['rd', 'Mismatch'], expired: ['rd', 'Expired'], needs_inspection: ['rd', 'Needs inspection'],
  pending: ['sl', 'Pending'], source_unavailable: ['am', 'Source unavailable'],
  manual_review: ['am', 'Manual review'], needs_more_evidence: ['am', 'Needs more evidence'],
  high: ['rd', 'High'], medium: ['am', 'Medium'], low: ['bl', 'Low'],
};

export default function StatusBadge({ value }) {
  const [tone, label] = TONES[value] || ['sl', String(value ?? 'Unknown').replace(/_/g, ' ')];
  return <span className={`p ${tone}`}>{label}</span>;
}

// Shared colours for charts (same palette as the badges)
export const COLORS = {
  high: '#dc2626', medium: '#d97706', low: '#2563eb',
  verified: '#16a34a', mismatch: '#dc2626', expired: '#b91c1c',
  source_unavailable: '#d97706', manual_review: '#f59e0b', pending: '#94a3b8',
};
