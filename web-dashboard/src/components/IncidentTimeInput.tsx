import { useId } from 'react';
import { Check } from 'lucide-react';
import { type IncidentTimeChoice, type IncidentTimeValue } from '../lib/incidentTime';

function toLocalDateTimeValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
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

    onChange({
      ...value,
      choice,
      occurredAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
      precision: 'approximate',
    });
  };

  const updateEarlierTime = (input: string) => {
    const parsed = new Date(input);
    if (!input || !Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now()) return;
    onChange({ ...value, choice: 'earlier', occurredAt: parsed.toISOString() });
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
          <label className="incident-time-datetime">
            Date and time
            <input
              type="datetime-local"
              max={toLocalDateTimeValue(new Date())}
              value={value.occurredAt ? toLocalDateTimeValue(new Date(value.occurredAt)) : ''}
              onChange={(event) => updateEarlierTime(event.target.value)}
              required
            />
          </label>
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
