import { useId } from 'react';
import { Check } from 'lucide-react';

export type IncidentTimeChoice = 'just_now' | 'earlier' | 'unknown';
export type IncidentTimePrecision = 'exact' | 'approximate' | 'unknown';

export type IncidentTimeValue = {
  choice: IncidentTimeChoice;
  occurredAt: string | null;
  precision: IncidentTimePrecision;
  earlierHours: number;
  earlierMinutes: number;
};

export function createInitialIncidentTime(): IncidentTimeValue {
  return {
    choice: 'just_now',
    occurredAt: new Date().toISOString(),
    precision: 'exact',
    earlierHours: 0,
    earlierMinutes: 30,
  };
}

function maxEarlierMinutes(now: Date) {
  return now.getHours() * 60 + now.getMinutes();
}

function earlierTimestamp(hours: number, minutes: number, now: Date) {
  return new Date(now.getTime() - (hours * 60 + minutes) * 60_000).toISOString();
}

function durationLabel(hours: number, minutes: number) {
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  return parts.length ? `${parts.join(' ')} ago` : 'less than a minute ago';
}

export default function IncidentTimeInput({
  value,
  onChange,
}: {
  value: IncidentTimeValue;
  onChange: (next: IncidentTimeValue) => void;
}) {
  const titleId = useId();

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

    const availableMinutes = maxEarlierMinutes(now);
    const initialMinutes = Math.min(30, availableMinutes);
    const hours = Math.floor(initialMinutes / 60);
    const minutes = initialMinutes % 60 || (availableMinutes > 0 ? 1 : 0);
    onChange({
      ...value,
      choice,
      earlierHours: hours,
      earlierMinutes: minutes,
      occurredAt: earlierTimestamp(hours, minutes, now),
      precision: 'approximate',
    });
  };

  const updateEarlierTime = (hours: number, minutes: number) => {
    const now = new Date();
    const availableMinutes = maxEarlierMinutes(now);
    const nextHours = Math.min(Math.max(0, hours), Math.floor(availableMinutes / 60));
    const maxMinutes = Math.min(59, Math.max(0, availableMinutes - nextHours * 60));
    let nextMinutes = Math.min(Math.max(0, minutes), maxMinutes);
    if (nextHours === 0 && nextMinutes === 0 && availableMinutes > 0) nextMinutes = 1;
    onChange({
      ...value,
      choice: 'earlier',
      earlierHours: nextHours,
      earlierMinutes: nextMinutes,
      occurredAt: earlierTimestamp(nextHours, nextMinutes, now),
      precision: value.precision === 'unknown' ? 'approximate' : value.precision,
    });
  };

  const availableMinutes = maxEarlierMinutes(new Date());
  const maxHours = Math.floor(availableMinutes / 60);
  const maxSelectedMinutes = Math.min(59, Math.max(0, availableMinutes - value.earlierHours * 60));

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
          <p className="incident-time-age">About {durationLabel(value.earlierHours, value.earlierMinutes)}</p>
          <div className="incident-time-duration">
            <label>
              Hours ago
              <select
                value={value.earlierHours}
                onChange={(event) => updateEarlierTime(Number(event.target.value), value.earlierMinutes)}
              >
                {Array.from({ length: maxHours + 1 }, (_, hour) => (
                  <option key={hour} value={hour}>{hour} {hour === 1 ? 'hour' : 'hours'}</option>
                ))}
              </select>
            </label>
            <label>
              Minutes ago
              <select
                value={value.earlierMinutes}
                onChange={(event) => updateEarlierTime(value.earlierHours, Number(event.target.value))}
              >
                {Array.from({ length: maxSelectedMinutes + 1 }, (_, minute) => (
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
