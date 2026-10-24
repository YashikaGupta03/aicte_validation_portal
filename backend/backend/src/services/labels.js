// Labels the frontend can show as-is. Colleges never see raw AI wording.
export function collegeStatusLabel(app) {
  switch (app.status) {
    case 'draft': return 'Draft';
    case 'submitted': return 'Submitted';
    case 'ai_running': return `AI checks running (${app.progress?.done ?? 0} of ${app.progress?.total ?? 5})`;
    case 'ai_failed': return 'Checks delayed';
    case 'ready_for_review': return 'Waiting for officer review';
    case 'under_review': return 'Under officer review';
    case 'more_info_requested': return 'More information requested';
    case 'approved': return 'Approved';
    case 'rejected': return 'Not approved';
    default: return app.status;
  }
}

export function officerStageLabel(app) {
  switch (app.status) {
    case 'ai_running': return `AI checks running (${app.progress?.done ?? 0} of ${app.progress?.total ?? 5})`;
    case 'ready_for_review': return 'Ready for review';
    case 'under_review': return 'Under review';
    case 'more_info_requested': return 'More information requested';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'ai_failed': return 'AI checks failed';
    default: return app.status;
  }
}
