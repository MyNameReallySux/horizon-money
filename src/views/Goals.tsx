import { useState } from 'react';
import type { Snapshot } from '../data/contract';
import { weeklyGoalProgress, type GoalProgress, type GoalStatus } from './goalsModel';
import './goals.css';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

const PERIODS = [
  { id: 'week', label: 'Week', ready: true },
  { id: 'month', label: 'Month', ready: false },
  { id: 'year', label: 'Year', ready: false },
] as const;

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STATUS_TEXT: Record<'max' | 'min', Record<GoalStatus, string>> = {
  max: { good: 'Under target', near: 'Near the cap', bad: 'Over target' },
  min: { good: 'Target met', near: 'Nearly there', bad: 'Behind target' },
};

/** A tick across the ring at `fraction` (0 to 1) of a full turn, starting at 12 o'clock. */
function Tick({ fraction, className }: { fraction: number; className: string }) {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (
    <line
      className={className}
      x1={50 + (RADIUS - 8) * cos}
      y1={50 + (RADIUS - 8) * sin}
      x2={50 + (RADIUS + 8) * cos}
      y2={50 + (RADIUS + 8) * sin}
    />
  );
}

function Ring({ row }: { row: GoalProgress }) {
  const { goal, ratio, status } = row;
  const stretch = goal.stretch;
  const scale = stretch !== undefined && stretch > goal.target ? stretch : goal.target;
  const fill = ratio === null ? 0 : Math.min(ratio * (goal.target / scale), 1);
  return (
    <svg className="goal-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="goal-ring-track" cx="50" cy="50" r={RADIUS} />
      <circle
        className={`goal-ring-fill goal-${status ?? 'none'}`}
        cx="50"
        cy="50"
        r={RADIUS}
        strokeDasharray={`${fill * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        transform="rotate(-90 50 50)"
      />
      {scale > goal.target && <Tick fraction={goal.target / scale} className="goal-tick" />}
      {stretch !== undefined && stretch > 0 && (
        <Tick fraction={Math.min(stretch / scale, 1)} className="goal-tick goal-tick-stretch" />
      )}
      <text className="goal-ring-text" x="50" y="50" textAnchor="middle" dominantBaseline="central">
        {ratio === null ? '--' : percent.format(ratio)}
      </text>
    </svg>
  );
}

function GoalCard({ row }: { row: GoalProgress }) {
  const { goal, actual, status, direction } = row;
  return (
    <li className="card goal-card">
      <Ring row={row} />
      <div className="goal-body">
        <h3 className="goal-name">{goal.name}</h3>
        <p className="goal-figures">
          {actual === null ? 'No data yet' : `${usd.format(actual)} of ${usd.format(goal.target)}`}
          <span className="goal-direction">{direction === 'max' ? ' cap' : ' floor'}</span>
        </p>
        <p className={`goal-status goal-text-${status ?? 'none'}`}>
          {status === null ? 'No data yet' : STATUS_TEXT[direction][status]}
        </p>
        {goal.stretch !== undefined && (
          <p className="goal-hint">Stretch: {usd.format(goal.stretch)}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Goals tab. Only the weekly period is built; month and year are disabled placeholders for the
 * monthly/yearly ticket (PER-616). Weekly actuals are estimates from month-to-date spending
 * (see `weeklyGoalProgress`), because the snapshot has no weekly transactions.
 */
export function Goals({ snapshot }: { snapshot: Snapshot }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const today = new Date().toLocaleDateString('en-CA');
  const rows = weeklyGoalProgress(snapshot, today);

  return (
    <section aria-labelledby="goals-title">
      <div className="goals-head">
        <h2 id="goals-title">Goals</h2>
        <div className="goals-periods" role="group" aria-label="Goal period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="goals-period"
              aria-pressed={period === p.id}
              disabled={!p.ready}
              title={p.ready ? undefined : 'Coming soon'}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
              {!p.ready && <span className="goals-soon"> (coming soon)</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="goal-hint">
        Weekly actuals are estimated from month-to-date spending (spent so far, divided by days
        elapsed, times 7). Goals on other metrics show no data yet.
      </p>
      {rows.length === 0 ? (
        <div className="card goals-empty">
          <p>No weekly goals yet.</p>
          <p className="goal-hint">
            Add targets with <code>period: "week"</code> to <code>targets.json</code> in the data
            directory; see the targets section of <code>docs/data-pipeline.md</code>.
          </p>
        </div>
      ) : (
        <ul className="goals-grid">
          {rows.map((row) => (
            <GoalCard key={row.goal.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
