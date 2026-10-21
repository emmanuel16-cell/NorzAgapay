import { useId } from 'react';
import { Check } from 'lucide-react';
import { type IncidentTimeChoice, type IncidentTimeValue } from '../lib/incidentTime';

const MINUTE_MS = 60_000;

function formatElapsedTime(totalMinutes: number) {
  if (totalMinutes === 0) return 'Less than a minute ago';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    ...(hours ? [`${hours} ${hours === 1 ? 'hour' : 'hours'}`] : []),
    ...(minutes ? [`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`] : []),
  ];
  return `${parts.join(' ')} ago`;
}

export default function IncidentTimeInput({
  value,
  onChange,
}: {
  value: IncidentTimeValue;
  onChange: (next: IncidentTimeValue) => void;
}) {
  const titleId = useId();
  const now = new Date();
  const occurredAtMs = value.occurredAt ? new Date(value.occurredAt).getTime() : Number.NaN;
  const elapsedMinutes = Number.isFinite(occurredAtMs)
    ? Math.max(0, Math.floor((now.getTime() - occurredAtMs) / MINUTE_MS))
    : 0;
  const maxEarlierMinutes = Math.max(now.getHours() * 60 + now.getMinutes(), elapsedMinutes);
  const earlierHours = Math.min(Math.floor(elapsedMinutes / 60), Math.floor(maxEarlierMinutes / 60));
  const earlierMinutes = Math.min(elapsedMinutes % 60, Math.min(59, maxEarlierMinutes - earlierHours * 60));

  const selectChoice = (choice: IncidentTimeChoice) => {
    const now = new Date();
    if (choice === 'unknown') {
      onChange({ ...value, choice, occurredAt: null, precision: 'unknown' });
      return;
    }
    if (choice === 'just_now') {
      onChange({ ...value, choice, occurredAt: now.toISOString(), precision: 'exact' });
      return;
    }
    if (value.choice === 'earlier') return;

    const availableMinutes = now.getHours() * 60 + now.getMinutes();
    const initialMinutes = Math.min(30, availableMinutes);
    let hours = Math.floor(initialMinutes / 60);
    let minutes = initialMinutes % 60;
    if (initialMinutes === 0 && availableMinutes > 0) minutes = 1;
    const occurredAt = new Date(now.getTime() - (hours * 60 + minutes) * MINUTE_MS);

    onChange({
      ...value,
      choice,
      occurredAt: occurredAt.toISOString(),
      precision: 'approximate',
    });
  };

  const updateEarlierTime = ({ hours, minutes }: { hours?: number; minutes?: number }) => {
    const currentTime = new Date();
    const currentOccurredAt = value.occurredAt ? new Date(value.occurredAt).getTime() : Number.NaN;
    const existingElapsedMinutes = Number.isFinite(currentOccurredAt)
      ? Math.max(0, Math.floor((currentTime.getTime() - currentOccurredAt) / MINUTE_MS))
      : 0;
    const maxMinutes = Math.max(currentTime.getHours() * 60 + currentTime.getMinutes(), existingElapsedMinutes);
    const nextHours = Math.max(0, Math.min(hours ?? earlierHours, Math.floor(maxMinutes / 60)));
    const maxMinutesForHour = Math.min(59, maxMinutes - nextHours * 60);
    let nextMinutes = Math.max(0, Math.min(minutes ?? earlierMinutes, maxMinutesForHour));
    if (nextHours === 0 && nextMinutes === 0 && maxMinutes > 0) nextMinutes = 1;

    const occurredAt = new Date(currentTime.getTime() - (nextHours * 60 + nextMinutes) * MINUTE_MS);
    onChange({
      ...value,
      choice: 'earlier',
      occurredAt: occurredAt.toISOString(),
      precision: value.precision === 'unknown' ? 'approximate' : value.precision,
    });
  };

  return (
    <div className="incident-time-control" role="group" aria-labelledby={titleId}>
      <div className="incident-time-title" id={titleId}>When did the incident happen?</div>
      <div className="incident-time-choices" role="group" aria-label="Incident time">
        {([
          ['just_now', 'Just now'],
          ['earlier', 'Earlier'],
          ['unknown', 'Not sure'],
        ] as const).map(([choice, label]) => {
          const selected = value.choice === choice;
          return (
            <button
              key={choice}
              className={`incident-time-choice${selected ? ' selected' : ''}`}
              type="button"
              aria-pressed={selected}
              onClick={() => selectChoice(choice)}
            >
              {selected && <Check size={14} aria-hidden="true" />}
              {label}
            </button>
          );
        })}
      </div>
      {value.choice === 'earlier' ? (
        <div className="incident-time-details">
          <p className="incident-time-age">{formatElapsedTime(earlierHours * 60 + earlierMinutes)}</p>
          <div className="incident-time-duration">
            <label>
              Hours ago
              <select value={earlierHours} onChange={(event) => updateEarlierTime({ hours: Number(event.target.value) })}>
                {Array.from({ length: Math.floor(maxEarlierMinutes / 60) + 1 }, (_, hour) => (
                  <option key={hour} value={hour}>{hour} {hour === 1 ? 'hour' : 'hours'}</option>
                ))}
              </select>
            </label>
            <label>
              Minutes ago
              <select value={earlierMinutes} onChange={(event) => updateEarlierTime({ minutes: Number(event.target.value) })}>
                {Array.from({ length: Math.min(59, maxEarlierMinutes - earlierHours * 60) + 1 }, (_, minute) => (
                  <option key={minute} value={minute}>{minute} {minute === 1 ? 'minute' : 'minutes'}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="incident-time-precision" role="group" aria-label="Time precision">
            <span>Time precision</span>
            <div>
              {(['exact', 'approximate'] as const).map((precision) => (
                <button
                  key={precision}
                  className={`incident-time-precision-choice${value.precision === precision ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={value.precision === precision}
                  onClick={() => onChange({ ...value, precision })}
                >
                  {precision === 'exact' ? 'Exact' : 'Approximate'}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : value.choice === 'unknown' ? (
        <p className="incident-time-hint">The incident time will be recorded as unknown.</p>
      ) : null}
    </div>
  );
}
