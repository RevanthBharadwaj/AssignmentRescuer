import { useApp } from '../AppContext';
import { Hint } from './Guide';
import { useAsync } from '../useAsync';
import { ReviewList } from './ReviewList';
import { Suggestions } from './Suggestions';

/** Inbox: everything still waiting for a decision, across all courses. */
export function Review() {
  const { service, version } = useApp();
  const { data: proposals } = useAsync(() => service.repository.listProposals('pending'), [version]);
  if (!proposals) return <p className="muted">Loading…</p>;
  return (
    <section aria-labelledby="review-title">
      <div className="page-head">
        <span className="chip">confirm it</span>
        <h1 id="review-title">Review extracted information</h1>
        <Hint id="review" />
        <p>{proposals.length === 0 ? 'Everything is confirmed.' : `${proposals.length} item${proposals.length === 1 ? '' : 's'} waiting across all courses. Changes and disagreements always need your decision.`}</p>
      </div>
      <Suggestions />
      <ReviewList proposals={proposals} />
    </section>
  );
}
