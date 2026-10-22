import { checkApprovals } from './plan.mjs';
import { validationPassed } from './state.mjs';

export function inspectResume(input, snapshot, add) {
  const { plan, state, context, previous, ruleInput } = input;
  if (snapshot.terminal) return { resume_decision: 'terminal', next_stage: null };
  if (!context.assignee || context.ready_for_ai !== true || context.conflicts !== false) add('intake_blocked','context');
  if (context.git.commit !== state.git.commit || context.git.branch !== state.git.branch ||
    context.git.clean !== true || context.git.remote_matches !== true) add('git_changed','context/git');
  if (context.work_source === 'github_issue' && (!context.issue_updated_at || context.issue_updated_at !== state.issue_updated_at)) add('issue_changed','context/issue_updated_at');
  if (state.status !== 'planned' || plan.revision > 1) {
    if (!previous) add('previous_missing','previous');
    if (state.resume.pending_operations.length || !state.resume.safe_to_retry || context.retry_review.confirmed !== true) add('unsafe_retry','state/resume');
    if (snapshot.last && !validationPassed(state,plan.revision,snapshot.last)) add('validation_missing','state/validations');
  }
  if (state.blockers.length) add('state_stopped','state/blockers');
  if (['blocked','failed'].includes(state.status)) add('state_stopped','state/status');
  if (state.status === 'awaiting_approval') add('state_stopped','state/status');
  if (snapshot.current !== null) add('state_stopped','state/current_stage');
  if (snapshot.expected) checkApprovals(state,plan,context,snapshot.expected,ruleInput,add);
  return { resume_decision: 'candidate', next_stage: snapshot.expected };
}
