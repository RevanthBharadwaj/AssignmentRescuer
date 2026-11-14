import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, type AssignmentSection, type CourseTab } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ChangeProposal, ConfirmedRecord } from '../../core/types';
import type { ImportInput, ImportResult } from '../../core/pipeline';
import { analyseAssignment } from '../../core/assignments/checklist';
import {
  MATERIAL_KINDS, MATERIAL_LABELS, buildAssignmentContext, policySections, sourceKind, sourcesForCourse, splitSections, toAnnouncement,
  type CourseSource, type MaterialKind, type PolicyTopic,
} from '../../core/courseContent';
import { FIELD_LABELS, errorMessage, formatDate, formatValue } from '../format';
import { SourceTrace } from './SourceTrace';
import { ReviewList } from './ReviewList';
import { TitlePage } from './TitlePage';
import { readFileBytes } from './AddInfo';
import { Breadcrumbs } from './Breadcrumbs';
import { CourseDot, ProgressBar, StatusButton, Urgency, courseColor, courseProgress, statusOf } from '../ux';

const dateOf = (r: ConfirmedRecord) => ((r.fields.dueDate ?? r.fields.date ?? null) as AcademicDate | null);
// Date first, then title, so "Question 1" comes before "Question 2" on the same day.
const sortKey = (r: ConfirmedRecord) => `${dateOf(r)?.iso ?? `9999-${String(dateOf(r)?.month ?? 99).padStart(2, '0')}-${String(dateOf(r)?.day ?? 99).padStart(2, '0')}`}|${String(r.fields.title ?? '')}`;
const byDue = (a: ConfirmedRecord, b: ConfirmedRecord) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true });
const unitNum = (u: unknown) => Number(/(\d+)/.exec(String(u ?? ''))?.[1] ?? 999);

const KIND_LABEL: Record<string, string> = { reading: 'reading', reading_file: 'reading file', lecture: 'lecture', file: 'file', page: 'page', forum: 'forum', link: 'link', tool: 'tool', note: 'reminder' };
const TOPIC_LABEL: Record<PolicyTopic, string> = {
  late: 'Late work', integrity: 'Academic integrity', ai: 'AI use', format: 'Formatting and citation', grading: 'Grading',
  participation: 'Participation', communication: 'Communication', accessibility: 'Accessibility', attendance: 'Attendance', submission: 'Submission',
};

/* ================= course list ================= */

export function CourseList() {
  const { service, version, go, today } = useApp();
  const { data } = useAsync(async () => ({
    records: await service.repository.listRecords(),
    pending: await service.repository.listProposals('pending'),
  }), [version]);
  if (!data) return <p className="muted">Loading…</p>;
  const courses = data.records.filter((r) => r.entityType === 'course');

  return (
    <section aria-labelledby="courses-title">
      <div className="page-head">
        <span className="chip">plan it</span>
        <h1 id="courses-title">Courses</h1>
        <p>Each course works like it does in Canvas: announcements, syllabus, modules, assignments and policies in their own places.</p>
      </div>
      {courses.length === 0 ? (
        <div className="card">
          <p>No courses yet.</p>
          <button type="button" onClick={() => go({ name: 'setup' })}>Set up your semester →</button>
        </div>
      ) : (
        <div className="course-grid">
          {courses.map((c, i) => {
            const code = String(c.fields.code);
            const items = data.records.filter((r) => r.fields.courseCode === code && (r.entityType === 'assignment' || r.entityType === 'timeline_event'));
            const next = items.filter((r) => (dateOf(r)?.iso ?? '') >= today && statusOf(r) !== 'submitted').sort(byDue)[0];
            const waiting = data.pending.filter((p) => p.candidate.fields.courseCode === code || p.candidate.provenance.importedInto === code).length;
            const prog = courseProgress(items);
            return (
              <button key={c.id} type="button" className="course-card stagger" style={{ ['--c' as string]: courseColor(code), ['--i' as string]: i }} onClick={() => go({ name: 'course', code })} aria-label={`Open ${code}`}>
                <span className="code">{code}</span>
                <span className="name">{String(c.fields.name ?? 'Name not set')}</span>
                {c.fields.instructor ? <span className="meta">{String(c.fields.instructor)}</span> : null}
                <span className="meta">{items.length} dated item{items.length === 1 ? '' : 's'}{waiting ? ` · ${waiting} to review` : ''}</span>
                <span className="next">{next ? <>next: {String(next.fields.title)} · {formatDate(dateOf(next))}</> : items.length ? 'nothing upcoming' : 'add material to fill this course'}</span>
                {prog.total > 0 && <><ProgressBar pct={prog.pct} color={courseColor(code)} label={`${code} progress`} /><span className="meta">{prog.pct}% of points submitted</span></>}
              </button>
            );
          })}
          <button type="button" className="course-card add" onClick={() => go({ name: 'setup' })}>
            <span className="code">+</span>
            <span className="name">Add a course</span>
          </button>
        </div>
      )}
    </section>
  );
}

/* ================= shared course data ================= */

interface CourseData {
  code: string;
  course: ConfirmedRecord | null;
  records: ConfirmedRecord[];
  mine: ConfirmedRecord[];
  sources: CourseSource[];
  pending: ChangeProposal[];
}

function useCourse(code: string): CourseData | null {
  const { service, version } = useApp();
  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    const allSources = await service.repository.listSources();
    const pending = (await service.repository.listProposals('pending')).filter((p) =>
      p.candidate.fields.courseCode === code || p.key === code || p.candidate.provenance.importedInto === code);
    return { records, allSources, pending };
  }, [version, code]);
  return useMemo(() => {
    if (!data) return null;
    return {
      code,
      course: data.records.find((r) => r.entityType === 'course' && r.fields.code === code) ?? null,
      records: data.records,
      mine: data.records.filter((r) => r.fields.courseCode === code),
      sources: sourcesForCourse(code, data.allSources, data.records),
      pending: data.pending,
    };
  }, [data, code]);
}

/* ================= course shell (left menu + breadcrumbs) ================= */

const NAV: { id: CourseTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'syllabus', label: 'Syllabus' },
  { id: 'modules', label: 'Modules' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'policies', label: 'Policies and rules' },
  { id: 'files', label: 'Files and sources' },
  { id: 'add', label: 'Add material' },
];

const TAB_LABEL = Object.fromEntries(NAV.map((n) => [n.id, n.label])) as Record<CourseTab, string>;

function CourseShell({ d, tab, extra, children }: { d: CourseData; tab: CourseTab; extra?: { label: string }; children: ReactNode }) {
  const { go } = useApp();
  const counts: Partial<Record<CourseTab, number>> = {
    announcements: d.sources.filter((s) => sourceKind(s) === 'announcement').length,
    assignments: d.mine.filter((r) => r.entityType === 'assignment').length,
    add: d.pending.length,
  };
  const trail = [
    { label: 'Home', route: { name: 'home' as const } },
    { label: 'Courses', route: { name: 'courses' as const } },
    { label: d.code, route: { name: 'course' as const, code: d.code } },
    ...(tab !== 'home' || extra ? [{ label: TAB_LABEL[tab], route: { name: 'course' as const, code: d.code, tab } }] : []),
    ...(extra ? [{ label: extra.label }] : []),
  ];
  return (
    <section className="course-shell" style={{ ['--c' as string]: courseColor(d.code) }} aria-labelledby="course-title">
      <Breadcrumbs trail={trail} />
      <div className="course-layout">
        <nav className="course-nav" aria-label={`${d.code} course menu`}>
          <div className="course-nav-head">
            <span className="course-chip-lg">{d.code}</span>
            <span className="muted small">{String(d.course?.fields.semester ?? '')}</span>
          </div>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={tab === n.id ? 'active' : ''}
              aria-current={tab === n.id ? 'page' : undefined}
              onClick={() => go({ name: 'course', code: d.code, tab: n.id })}
            >
              {n.label}
              {counts[n.id] ? <span className={n.id === 'add' ? 'badge' : 'count'}>{counts[n.id]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="course-main">{children}</div>
      </div>
    </section>
  );
}

function PageHead({ d, title, sub }: { d: CourseData; title: string; sub?: ReactNode }) {
  return (
    <div className="page-head course-head">
      <span className="chip course-chip">{d.code.toLowerCase()} · {String(d.course?.fields.name ?? '')}</span>
      <h1 id="course-title">{title}</h1>
      {sub ? <p className="muted">{sub}</p> : null}
    </div>
  );
}

function Empty({ d, kind, text }: { d: CourseData; kind?: MaterialKind; text: string }) {
  const { go } = useApp();
  return (
    <div className="card empty-card">
      <p>{text}</p>
      <button type="button" onClick={() => go({ name: 'course', code: d.code, tab: 'add', addKind: kind })}>
        Add {kind ? MATERIAL_LABELS[kind].toLowerCase() : 'material'} →
      </button>
    </div>
  );
}

/* ================= course page router ================= */

export function CoursePage({ code, tab = 'home', addKind, forAssignment }: { code: string; tab?: CourseTab; addKind?: string; forAssignment?: string }) {
  const d = useCourse(code);
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <CourseShell d={d} tab={tab}>
      {tab === 'home' && <CourseHome d={d} />}
      {tab === 'announcements' && <Announcements d={d} />}
      {tab === 'syllabus' && <Syllabus d={d} />}
      {tab === 'modules' && <Modules d={d} />}
      {tab === 'assignments' && <Assignments d={d} />}
      {tab === 'policies' && <Policies d={d} />}
      {tab === 'files' && <Files d={d} />}
      {tab === 'add' && <AddToCourse d={d} initialKind={addKind as MaterialKind | undefined} forAssignment={forAssignment} />}
    </CourseShell>
  );
}

/* ================= course home ================= */

function CourseHome({ d }: { d: CourseData }) {
  const { go, today } = useApp();
  const graded = d.mine.filter((r) => r.entityType === 'assignment');
  const dated = d.mine.filter((r) => (r.entityType === 'assignment' || r.entityType === 'timeline_event') && r.fields.kind !== 'module' && dateOf(r));
  const upcoming = dated.filter((r) => (dateOf(r)?.iso ?? '') >= today && statusOf(r) !== 'submitted').sort(byDue).slice(0, 6);
  const overdue = dated.filter((r) => r.entityType === 'assignment' && (dateOf(r)?.iso ?? '9') < today && statusOf(r) !== 'submitted');
  const undated = graded.filter((r) => !dateOf(r));
  const announcements = d.sources.filter((s) => sourceKind(s) === 'announcement').map(toAnnouncement).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const prog = courseProgress(graded);
  const hasSyllabus = d.sources.some((s) => sourceKind(s) === 'syllabus');

  return (
    <>
      <PageHead d={d} title={String(d.course?.fields.name ?? d.code)} sub={<>
        {d.course?.fields.instructor ? `${String(d.course.fields.instructor)} · ` : ''}{graded.length} graded item{graded.length === 1 ? '' : 's'}
        {d.course?.fields.section ? ` · section ${String(d.course.fields.section)}` : ''}
      </>} />
      {graded.length > 0 && (
        <div className="course-progress">
          <ProgressBar pct={prog.pct} color={courseColor(d.code)} label={`${d.code} progress`} />
          <span className="muted small">{prog.pct}% of points submitted · {graded.filter((a) => statusOf(a) === 'submitted').length} of {graded.length} done</span>
        </div>
      )}

      {graded.length === 0 && (
        <Empty d={d} kind="modules" text="This course is empty. Start with the Canvas Modules page (select all, copy, paste), then add the syllabus and announcements." />
      )}

      <div className="home-grid">
        <div>
          {overdue.length > 0 && (
            <div className="card notice">
              <h2>Overdue</h2>
              <DueList items={overdue} />
            </div>
          )}
          <div className="card">
            <h2>Coming up</h2>
            {upcoming.length ? <DueList items={upcoming} /> : <p className="muted">Nothing upcoming.</p>}
            <button type="button" className="link" onClick={() => go({ name: 'course', code: d.code, tab: 'modules' })}>see all by module →</button>
          </div>
          {undated.length > 0 && (
            <div className="card">
              <h2>Still needs a date</h2>
              <ul className="plain-list">
                {undated.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button>
                    <span className="muted small"> · {typeof r.fields.dueNote === 'string' ? r.fields.dueNote : 'no date in your material'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <aside>
          <div className="card">
            <h2>Latest announcements</h2>
            {announcements.length === 0 ? <p className="muted small">None added yet.</p> : (
              <ul className="plain-list">
                {announcements.map((a) => <li key={a.source.id}><span className="muted small mono">{a.date}</span><br />{a.title}</li>)}
              </ul>
            )}
            <button type="button" className="link" onClick={() => go({ name: 'course', code: d.code, tab: announcements.length ? 'announcements' : 'add', addKind: announcements.length ? undefined : 'announcement' })}>
              {announcements.length ? 'all announcements →' : 'add an announcement →'}
            </button>
          </div>
          <div className="card">
            <h2>Course material</h2>
            <ul className="plain-list kinds">
              {MATERIAL_KINDS.filter((k) => k !== 'other').map((k) => {
                const n = d.sources.filter((s) => sourceKind(s) === k).length;
                return <li key={k}><span className={`kind-badge k-${k}`}>{MATERIAL_LABELS[k]}</span> <span className="muted small">{n ? `${n} added` : 'none yet'}</span></li>;
              })}
            </ul>
            {!hasSyllabus && <button type="button" className="link" onClick={() => go({ name: 'course', code: d.code, tab: 'add', addKind: 'syllabus' })}>add the syllabus →</button>}
          </div>
        </aside>
      </div>
    </>
  );
}

function DueList({ items }: { items: ConfirmedRecord[] }) {
  const { go } = useApp();
  return (
    <ul className="deadlines compact-list">
      {items.map((r, i) => (
        <li key={r.id} className={`stagger ${statusOf(r) === 'submitted' ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
          <span className="date">{r.entityType === 'assignment' ? <StatusButton record={r} compact /> : <span className="status-spacer" />} {formatDate(dateOf(r))}</span>
          <span className="title">
            {r.entityType === 'assignment' ? <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button> : String(r.fields.title)}
          </span>
          <span className="row-end"><Urgency record={r} />{typeof r.fields.pointsPossible === 'number' ? <span className="tag">{r.fields.pointsPossible} pts</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/* ================= announcements ================= */

function Announcements({ d }: { d: CourseData }) {
  const list = d.sources.filter((s) => sourceKind(s) === 'announcement').map(toAnnouncement).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <PageHead d={d} title="Announcements" sub="Newest first. Announcements that mention an assignment also appear on that assignment's page." />
      {list.length === 0 ? <Empty d={d} kind="announcement" text="No announcements yet. Copy one from Canvas and add it here." /> : list.map((a, i) => (
        <article key={a.source.id} className="card announcement stagger" style={{ ['--i' as string]: i }} aria-label={`Announcement: ${a.title}`}>
          <header><span className="kind-badge k-announcement">Announcement</span> <span className="muted small mono">{a.date}</span></header>
          <h2>{a.title}</h2>
          <p className="pre">{a.body}</p>
          <p className="muted small">From {a.source.originalName}</p>
        </article>
      ))}
    </>
  );
}

/* ================= syllabus ================= */

function Syllabus({ d }: { d: CourseData }) {
  const syllabi = d.sources.filter((s) => sourceKind(s) === 'syllabus');
  return (
    <>
      <PageHead d={d} title="Syllabus" sub="Section by section. Policy sections are marked; they also feed each assignment's context." />
      {syllabi.length === 0 ? <Empty d={d} kind="syllabus" text="No syllabus yet. Paste it or drop the PDF or Word file." /> : syllabi.map((s) => {
        const policyHeads = new Set(policySections(s).map((p) => p.heading));
        return (
          <div key={s.id} className="syllabus">
            <p className="muted small">From {s.originalName}</p>
            {splitSections(s.text).map((sec, i) => (
              <details key={`${sec.heading}-${i}`} className={`card section stagger ${policyHeads.has(sec.heading) ? 'is-policy' : ''}`} style={{ ['--i' as string]: i }} open={i < 2 || policyHeads.has(sec.heading)}>
                <summary>
                  <span>{sec.heading}</span>
                  {policyHeads.has(sec.heading) && <span className="kind-badge k-policy">policy</span>}
                  {sec.topics.slice(0, 3).map((t) => <span key={t} className="tag">{TOPIC_LABEL[t]}</span>)}
                </summary>
                {sec.body && <p className="pre">{sec.body}</p>}
              </details>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ================= modules ================= */

function Modules({ d }: { d: CourseData }) {
  const { go } = useApp();
  const items = d.mine.filter((r) => (r.entityType === 'assignment' || r.entityType === 'course_material' || r.entityType === 'timeline_event') && r.fields.kind !== 'module');
  const units = new Map<string, ConfirmedRecord[]>();
  for (const r of items) {
    const u = String(r.fields.unit ?? 'Course resources');
    units.set(u, [...(units.get(u) ?? []), r]);
  }
  const ordered = [...units.entries()].sort((a, b) => unitNum(a[0]) - unitNum(b[0]));
  const order = (r: ConfirmedRecord) => (r.entityType === 'course_material' ? (r.fields.kind === 'note' ? 3 : 0) : 1);

  return (
    <>
      <PageHead d={d} title="Modules" sub="Your course week by week, the way Canvas lists it: readings and lectures first, then graded work." />
      {ordered.length === 0 ? <Empty d={d} kind="modules" text="No modules yet. In Canvas open Modules, select all, copy, and paste it here." /> : ordered.map(([unit, list], i) => (
        <details key={unit} className="card module stagger" style={{ ['--i' as string]: i }} open>
          <summary><h2>{unit}</h2><span className="muted small">{list.filter((r) => r.entityType === 'assignment').length} graded · {list.filter((r) => r.entityType === 'course_material' && r.fields.kind !== 'note').length} readings and files</span></summary>
          <ul className="module-items">
            {[...list].sort((a, b) => order(a) - order(b) || byDue(a, b)).map((r) => (
              <li key={r.id} className={`${r.entityType} ${statusOf(r) === 'submitted' ? 'is-done' : ''}`}>
                {r.entityType === 'assignment' ? (
                  <>
                    <StatusButton record={r} compact />
                    <button type="button" className="link plain title" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button>
                    <span className="row-end">
                      <span className="muted small mono">{dateOf(r) ? formatDate(dateOf(r)) : 'no date'}</span>
                      <Urgency record={r} />
                      {typeof r.fields.pointsPossible === 'number' ? <span className="tag">{r.fields.pointsPossible} pts</span> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`item-icon k-${String(r.fields.kind)}`} aria-hidden="true" />
                    <span className="title">{String(r.fields.title)}</span>
                    <span className="row-end"><span className="tag">{KIND_LABEL[String(r.fields.kind)] ?? String(r.fields.kind ?? '')}</span></span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

/* ================= assignments ================= */

const FILTERS: { id: string; label: string; types: string[] | null }[] = [
  { id: 'all', label: 'All', types: null },
  { id: 'discussion', label: 'Discussions', types: ['discussion', 'peer_reply'] },
  { id: 'writing', label: 'Writing', types: ['essay', 'paper', 'report', 'reflection'] },
  { id: 'project', label: 'Projects', types: ['project', 'presentation'] },
  { id: 'tests', label: 'Quizzes and exams', types: ['quiz', 'exam'] },
];

function Assignments({ d }: { d: CourseData }) {
  const { go } = useApp();
  const [filter, setFilter] = useState('all');
  const all = d.mine.filter((r) => r.entityType === 'assignment');
  const f = FILTERS.find((x) => x.id === filter)!;
  const shown = all.filter((r) => !f.types || f.types.includes(String(r.fields.type))).sort(byDue);
  const total = all.reduce((s, r) => s + (typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : 0), 0);
  return (
    <>
      <PageHead d={d} title="Assignments" sub={`${all.length} graded items · ${total} points listed in your material · ${courseProgress(all).pct}% of points submitted`} />
      {all.length === 0 ? <Empty d={d} kind="modules" text="No assignments yet. Paste the Canvas Modules or Assignments page." /> : (
        <>
          <div className="segmented filter" role="group" aria-label="Filter assignments">
            {FILTERS.map((x) => {
              const n = all.filter((r) => !x.types || x.types.includes(String(r.fields.type))).length;
              return n || x.id === 'all' ? <button key={x.id} type="button" className={filter === x.id ? 'on' : ''} aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>{x.label} <span className="count">{n}</span></button> : null;
            })}
          </div>
          <table className="timeline">
            <thead><tr><th>Status</th><th>Due</th><th>Assignment</th><th>Type</th><th>Unit</th><th>Points</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id} className={`stagger ${statusOf(r) === 'submitted' ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
                  <td><StatusButton record={r} /></td>
                  <td>{dateOf(r) ? <>{formatDate(dateOf(r))} <Urgency record={r} /></> : <span className="warn-text">no date</span>}</td>
                  <td><button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button></td>
                  <td>{String(r.fields.type ?? '').replace('_', ' ')}</td>
                  <td>{String(r.fields.unit ?? '')}</td>
                  <td>{typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/* ================= policies ================= */

function Policies({ d }: { d: CourseData }) {
  const all = d.sources
    .filter((s) => ['syllabus', 'policy'].includes(sourceKind(s)))
    .flatMap((s) => policySections(s).map((sec) => ({ sec, source: s })));
  const topics = [...new Set(all.flatMap((p) => p.sec.topics))];
  const [topic, setTopic] = useState<PolicyTopic | null>(null);
  const shown = all.filter((p) => !topic || p.sec.topics.includes(topic));
  return (
    <>
      <PageHead d={d} title="Policies and rules" sub="Collected from the syllabus and any rules or principles you add. Each assignment shows the ones that apply to it." />
      {all.length === 0 ? <Empty d={d} kind="policy" text="No policies yet. Add the syllabus, or paste the course rules, principles or expectations." /> : (
        <>
          <div className="legend">
            <button type="button" className={`legend-item ${topic === null ? '' : 'off-soft'}`} onClick={() => setTopic(null)}>All {all.length}</button>
            {topics.map((t) => <button key={t} type="button" className={`legend-item ${topic === t ? '' : 'off-soft'}`} aria-pressed={topic === t} onClick={() => setTopic(t)}>{TOPIC_LABEL[t]}</button>)}
          </div>
          {shown.map(({ sec, source }, i) => (
            <article key={`${source.id}-${sec.line}`} className="card policy stagger" style={{ ['--i' as string]: i }} aria-label={`Policy: ${sec.heading}`}>
              <h2>{sec.heading}</h2>
              <p className="pre">{sec.body}</p>
              <p className="muted small">{sec.topics.map((t) => TOPIC_LABEL[t]).join(' · ')}{sec.topics.length ? ' · ' : ''}from {source.originalName}, line {sec.line}</p>
            </article>
          ))}
        </>
      )}
    </>
  );
}

/* ================= files and sources ================= */

function Files({ d }: { d: CourseData }) {
  const { service, refresh, toast } = useApp();
  const materials = d.mine.filter((r) => r.entityType === 'course_material' && r.fields.kind !== 'note');
  const groups = new Map<string, ConfirmedRecord[]>();
  for (const m of materials) {
    const u = String(m.fields.unit ?? 'Course resources');
    groups.set(u, [...(groups.get(u) ?? []), m]);
  }
  const ordered = [...groups.entries()].sort((a, b) => unitNum(a[0]) - unitNum(b[0]));
  return (
    <>
      <PageHead d={d} title="Files and sources" sub="Everything you added to this course, labelled by what it is. Change a label if the app guessed wrong." />
      {d.sources.length === 0 ? <Empty d={d} text="Nothing added yet." /> : (
        <table className="timeline sources-table">
          <thead><tr><th>What it is</th><th>Name</th><th>Added</th><th /></tr></thead>
          <tbody>
            {d.sources.map((s) => (
              <tr key={s.id}>
                <td><span className={`kind-badge k-${sourceKind(s)}`}>{MATERIAL_LABELS[sourceKind(s)]}</span></td>
                <td>{s.originalName}<span className="muted small"> · {s.format}{s.pageOffsets ? ` · ${s.pageOffsets.length} pages` : ''}</span></td>
                <td className="mono small">{s.importedAt.slice(0, 10)}</td>
                <td>
                  <label className="inline-select">
                    <span className="sr-only">Change what {s.originalName} is</span>
                    <select aria-label={`What is ${s.originalName}`} value={sourceKind(s)} onChange={async (e) => {
                      await service.repository.updateSourceHints(s.id, { material: e.target.value });
                      refresh();
                      toast(`${s.originalName} is now filed as ${MATERIAL_LABELS[e.target.value as MaterialKind].toLowerCase()}`);
                    }}>
                      {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{MATERIAL_LABELS[k]}</option>)}
                    </select>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ordered.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Readings, lectures and files from the modules</h2>
          <div className="materials">
            {ordered.map(([unit, list]) => (
              <div key={unit} className="material-group">
                <h3><CourseDot code={d.code} /> {unit}</h3>
                <ul>{list.map((m) => <li key={m.id}><span className="tag">{KIND_LABEL[String(m.fields.kind)] ?? String(m.fields.kind)}</span><span>{String(m.fields.title)}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ================= add material ================= */

const KIND_HELP: Record<MaterialKind, string> = {
  syllabus: 'The course syllabus: dates, schedule, grading, policies.',
  announcement: 'An announcement or message from your instructor.',
  modules: 'The Canvas Modules page: select all on the page, copy, paste.',
  instructions: 'The instructions for one assignment, discussion or project.',
  rubric: 'A grading rubric for one assignment.',
  policy: 'Course rules, principles or expectations (writing, AI, late work, conduct).',
  reading: 'A reading, lecture notes or an article.',
  other: 'Anything else. The app will try to work out what it is.',
};

function AddToCourse({ d, initialKind, forAssignment }: { d: CourseData; initialKind?: MaterialKind; forAssignment?: string }) {
  const { service, refresh } = useApp();
  const [kind, setKind] = useState<MaterialKind | 'auto'>(initialKind ?? (forAssignment ? 'instructions' : 'auto'));
  const [target, setTarget] = useState<string>(forAssignment ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assignments = d.mine.filter((r) => r.entityType === 'assignment').sort(byDue);
  const targetRec = assignments.find((a) => a.id === target) ?? null;

  const hints = () => ({
    ...(kind !== 'auto' ? { material: kind } : {}),
    ...(targetRec && (kind === 'instructions' || kind === 'rubric') ? { assignmentKey: targetRec.key, assignmentTitle: String(targetRec.fields.title) } : {}),
  });

  const run = async (inputs: ImportInput[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await service.importForCourse(d.code, inputs.map((i) => ({ ...i, hints: { ...hints(), ...(i.hints ?? {}) } }) as ImportInput));
      setResult(r);
      if (r.sources.length) setText('');
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const onFiles = async (files: FileList | File[]) => {
    const inputs: ImportInput[] = [];
    for (const f of Array.from(files)) inputs.push({ kind: 'file', name: f.name, bytes: await readFileBytes(f) });
    if (inputs.length) await run(inputs);
  };
  const found = result ? result.proposals.length : 0;

  return (
    <>
      <PageHead d={d} title="Add material" sub="Say what you are adding so it lands in the right place." />
      <fieldset className="kind-picker">
        <legend>What are you adding?</legend>
        <div className="kind-options">
          {(['auto', ...MATERIAL_KINDS.filter((k) => k !== 'other')] as const).map((k) => (
            <label key={k} className={`kind-option ${kind === k ? 'on' : ''}`}>
              <input type="radio" name="material-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span className={`kind-badge k-${k === 'auto' ? 'other' : k}`}>{k === 'auto' ? 'Not sure' : MATERIAL_LABELS[k]}</span>
              <span className="muted small">{k === 'auto' ? 'Let the app work it out.' : KIND_HELP[k]}</span>
            </label>
          ))}
        </div>
        {(kind === 'instructions' || kind === 'rubric') && assignments.length > 0 && (
          <label className="for-assignment">For which assignment?
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">A new assignment (read its title from the text)</option>
              {assignments.map((a) => <option key={a.id} value={a.id}>{String(a.fields.title)}{dateOf(a) ? ` · ${formatDate(dateOf(a))}` : ''}</option>)}
            </select>
          </label>
        )}
      </fieldset>

      <div
        className={`card dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files); }}
      >
        <label htmlFor="course-paste" className="label">
          Paste {kind === 'auto' ? 'anything' : MATERIAL_LABELS[kind].toLowerCase()} for {d.code}{targetRec ? ` (for ${String(targetRec.fields.title)})` : ''}
        </label>
        <textarea id="course-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'modules' || kind === 'auto' ? 'In Canvas: open Modules, press Cmd+A then Cmd+C, and paste here.' : 'Paste the text here, or drop a PDF or Word file on this card.'} />
        <div className="row">
          <button type="button" disabled={busy || !text.trim()} onClick={() => run([{ kind: 'text', text, label: `${kind === 'auto' ? 'Pasted' : MATERIAL_LABELS[kind]} (${d.code})` }])}>{busy ? 'Reading…' : 'Extract'}</button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Choose files…</button>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.ics,.txt,.md,text/plain" aria-label="Choose files for this course" onChange={(e) => e.target.files && void onFiles(e.target.files)} />
          <span className="muted small">or drop PDF, Word, calendar (.ics), TXT or Markdown files on this card.</span>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
      {result && (
        <div className={`card import-result ${found ? 'ok' : 'empty'}`} aria-live="polite">
          <strong>{found ? `Found ${found} item${found === 1 ? '' : 's'} for ${d.code}` : result.sources.length ? `Saved to ${d.code}` : 'Nothing was added'}</strong>
          {result.sources.map((s) => (
            <p key={s.source.id} className="small">
              <span className={`kind-badge k-${sourceKind({ ...s.source, classifications: s.classifications })}`}>{MATERIAL_LABELS[sourceKind({ ...s.source, classifications: s.classifications })]}</span>{' '}
              {s.source.originalName}: {s.records.length} item{s.records.length === 1 ? '' : 's'}
              {result.duplicateInputs.some((x) => x.existingSourceId === s.source.id && x.reprocessed) ? ' (added before; read again for this course)' : ''}
            </p>
          ))}
          {result.errors.map((e) => <p key={e.inputName} className="error small">{e.message}</p>)}
          {found > 0 && <p className="small muted">Review below, then approve.</p>}
        </div>
      )}
      <h2 style={{ marginTop: 32 }}>Waiting for your review</h2>
      <ReviewList proposals={d.pending} emptyText={`Nothing waiting for ${d.code}.`} />
    </>
  );
}

/* ================= assignment page ================= */

const A_SECTIONS: { id: AssignmentSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'rubric', label: 'Rubric' },
  { id: 'context', label: 'Course context' },
  { id: 'title', label: 'Title page' },
];

export function AssignmentWorkspace({ id, section = 'overview' }: { id: string; section?: AssignmentSection }) {
  const { service, version, go, refresh } = useApp();
  const { data } = useAsync(async () => ({
    all: await service.repository.listRecords(),
    sources: await service.repository.listSources(),
  }), [version]);
  const record = data?.all.find((r) => r.id === id) ?? null;
  const code = String(record?.fields.courseCode ?? '');
  const d = useCourse(code);
  const [date, setDate] = useState('');
  if (!data || !d) return <p className="muted">Loading…</p>;
  if (!record) return <p className="muted">This item no longer exists.</p>;

  const ctx = buildAssignmentContext(record, data.all, data.sources);
  const a = analyseAssignment(record, ctx.rubric);
  const isPaper = ['paper', 'essay', 'report', 'reflection', 'project', 'assignment'].includes(String(record.fields.type));
  const counts: Partial<Record<AssignmentSection, number>> = {
    instructions: ctx.instructions.length + (typeof record.fields.instructions === 'string' ? 1 : 0),
    rubric: ctx.rubric.length,
    context: ctx.policies.length + ctx.announcements.length + ctx.readings.length,
  };
  const doneIds = Array.isArray(record.fields.checklistDone) ? (record.fields.checklistDone as string[]) : [];
  const shown = Object.entries(record.fields).filter(([k, v]) => !['instructions', 'title', 'paperTitle', 'status', 'checklistDone'].includes(k) && v !== null);

  return (
    <CourseShell d={d} tab="assignments" extra={{ label: String(record.fields.title) }}>
      <div className="page-head course-head">
        <span className="chip course-chip">{String(record.fields.type ?? 'assignment').replace('_', ' ')}{record.fields.unit ? ` · ${String(record.fields.unit)}` : ''}</span>
        <h1 id="ws-title">{String(record.fields.title)}</h1>
        <p className="muted">
          {dateOf(record) ? `Due ${formatDate(dateOf(record))}` : typeof record.fields.dueNote === 'string' ? record.fields.dueNote : 'No due date yet'}
          {typeof record.fields.pointsPossible === 'number' ? ` · ${record.fields.pointsPossible} points` : ''}
        </p>
        <div className="row"><StatusButton record={record} /> <Urgency record={record} /></div>
      </div>

      <div className="tabs" role="tablist" aria-label="Assignment sections">
        {A_SECTIONS.filter((s) => s.id !== 'title' || isPaper).map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? 'active' : ''} onClick={() => go({ name: 'assignment', id, section: s.id })}>
            {s.label}{counts[s.id] ? <span className="count">{counts[s.id]}</span> : null}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <>
          {!dateOf(record) && (
            <div className="card notice">
              <label>Set the due date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <button type="button" style={{ marginTop: 10 }} disabled={!date} onClick={async () => {
                const [y, m, dd] = date.split('-').map(Number);
                await service.repository.correctRecord(record.id, { dueDate: { iso: date, year: y, month: m, day: dd, yearSource: 'explicit', time: null, timeZone: null, raw: date } });
                refresh();
              }}>Save date</button>
            </div>
          )}
          <div className="card">
            <h2>Requirements checklist</h2>
            <ul className="checklist">
              {a.checklist.map((c) => {
                const on = doneIds.includes(c.id);
                return (
                  <li key={c.id} className={on ? 'is-done' : ''}>
                    <label>
                      <input type="checkbox" checked={on} onChange={async () => {
                        await service.repository.correctRecord(record.id, { checklistDone: on ? doneIds.filter((x) => x !== c.id) : [...doneIds, c.id] });
                        refresh();
                      }} /> {c.text}
                    </label>
                  </li>
                );
              })}
            </ul>
            {a.checklist.length > 0 && <ProgressBar pct={Math.round((a.checklist.filter((c) => doneIds.includes(c.id)).length / a.checklist.length) * 100)} color={courseColor(code)} label="Checklist progress" />}
            {a.missing.length > 0 && (
              <p className="warning">
                Not found in your material yet: {a.missing.join(', ')}.{' '}
                <button type="button" className="link" onClick={() => go({ name: 'course', code, tab: 'add', addKind: 'instructions', forAssignment: record.id })}>Add the instructions or rubric for this assignment →</button>
              </p>
            )}
          </div>
          {(ctx.announcements.length > 0 || ctx.policies.length > 0) && (
            <div className="card notice">
              <h2>From your course</h2>
              <p className="small">{ctx.announcements.length ? `${ctx.announcements.length} announcement${ctx.announcements.length === 1 ? ' mentions' : 's mention'} this assignment. ` : ''}{ctx.policies.length ? `${ctx.policies.length} syllabus rule${ctx.policies.length === 1 ? '' : 's'} apply, starting with ${ctx.policies.slice(0, 3).map((p) => `“${p.title}”`).join(', ')}.` : ''}</p>
              <button type="button" className="link" onClick={() => go({ name: 'assignment', id, section: 'context' })}>see the course context →</button>
            </div>
          )}
          <div className="card">
            <h2>Details</h2>
            <dl className="fields">{shown.map(([k, v]) => <div key={k}><dt>{FIELD_LABELS[k] ?? k}</dt><dd>{formatValue(v)}</dd></div>)}</dl>
            <SourceTrace provenance={record.evidence} />
          </div>
        </>
      )}

      {section === 'instructions' && (
        <>
          {typeof record.fields.instructions === 'string' && (
            <div className="card"><h2>Instructions</h2><p className="pre">{record.fields.instructions}</p></div>
          )}
          {ctx.instructions.filter((x) => x.body !== record.fields.instructions).map((x) => (
            <div key={x.sourceId} className="card"><h2>{x.title}</h2><p className="pre">{x.body}</p></div>
          ))}
          {counts.instructions === 0 && (
            <Empty d={d} kind="instructions" text="No instructions yet. Copy them from the assignment page in Canvas and add them here; they will be linked to this assignment." />
          )}
          <button type="button" className="secondary" onClick={() => go({ name: 'course', code, tab: 'add', addKind: 'instructions', forAssignment: record.id })}>Add instructions for this assignment</button>
        </>
      )}

      {section === 'rubric' && (
        ctx.rubric.length === 0 ? (
          <div className="card empty-card">
            <p>No rubric linked yet.</p>
            <button type="button" onClick={() => go({ name: 'course', code, tab: 'add', addKind: 'rubric', forAssignment: record.id })}>Add the rubric for this assignment →</button>
          </div>
        ) : (
          <table className="timeline">
            <thead><tr><th>Criterion</th><th>Points</th><th>Description</th><th>Levels</th></tr></thead>
            <tbody>{ctx.rubric.map((r) => (
              <tr key={r.id}><td>{String(r.fields.criterion)}</td><td>{String(r.fields.maxPoints ?? '')}</td><td>{String(r.fields.description ?? '')}</td><td>{Array.isArray(r.fields.performanceLevels) ? r.fields.performanceLevels.join(', ') : ''}</td></tr>
            ))}</tbody>
          </table>
        )
      )}

      {section === 'context' && (
        <div className="context">
          <p className="muted">What your course says that applies to this {String(record.fields.type ?? 'assignment').replace('_', ' ')}. Every item shows where it came from.</p>
          <ContextGroup title="Announcements about this assignment" empty="No announcement mentions it." items={ctx.announcements} />
          <ContextGroup title="Syllabus rules that apply" empty="No syllabus or policies added yet." items={ctx.policies} />
          <ContextGroup title={`Readings and notes for ${String(record.fields.unit ?? 'this unit')}`} empty="No readings for this unit." items={ctx.readings} />
        </div>
      )}

      {section === 'title' && isPaper && <TitlePage record={record} />}
    </CourseShell>
  );
}

function ContextGroup({ title, empty, items }: { title: string; empty: string; items: ReturnType<typeof buildAssignmentContext>['policies'] }) {
  return (
    <div className="card context-group">
      <h2>{title} <span className="count">{items.length}</span></h2>
      {items.length === 0 ? <p className="muted small">{empty}</p> : (
        <ul className="context-items">
          {items.map((x, i) => (
            <li key={`${x.sourceId}-${x.title}-${i}`} className="stagger" style={{ ['--i' as string]: i }}>
              <details open={i < 3}>
                <summary>
                  <span className={`kind-badge k-${x.kind === 'policy' ? 'policy' : x.kind === 'announcement' ? 'announcement' : 'reading'}`}>{x.kind === 'note' ? 'reminder' : x.kind}</span>
                  <strong>{x.title}</strong>
                  {x.topics?.slice(0, 2).map((t) => <span key={t} className="tag">{TOPIC_LABEL[t]}</span>)}
                </summary>
                {x.kind !== 'reading' && x.kind !== 'note' && <p className="pre">{x.body}</p>}
                <p className="muted small">from {x.sourceName}{x.location ? `, ${x.location}` : ''}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
