type NotificationSound =
  | 'incident'
  | 'criticalIncident'
  | 'assistance'
  | 'escalation'
  | 'review'
  | 'assigned'
  | 'responding'
  | 'dispatch'
  | 'arrival'
  | 'resolved';

let audioContext: AudioContext | null = null;
let unlockListenersInstalled = false;
let pendingSound: NotificationSound | null = null;
let pendingSoundTimer: number | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext ??= new AudioContextClass();
  return audioContext;
}

function playTone(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
): void {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(volume, startAt + 0.018);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(envelope);
  envelope.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function playNow(kind: NotificationSound): void {
  const context = getAudioContext();
  if (!context || context.state !== 'running') return;
  const startAt = context.currentTime + 0.015;

  const notes: Record<NotificationSound, Array<[number, number, number, number]>> = {
    incident: [[880, 0.16, 0.06, 0.075], [660, 0.16, 0.06, 0.075], [880, 0.2, 0.02, 0.075]],
    criticalIncident: [[1046.5, 0.12, 0.04, 0.095], [784, 0.12, 0.04, 0.095], [1046.5, 0.18, 0.02, 0.095]],
    assistance: [[659.25, 0.16, 0.08, 0.05], [880, 0.24, 0.02, 0.05]],
    escalation: [[523.25, 0.13, 0.04, 0.065], [698.46, 0.13, 0.04, 0.065], [880, 0.2, 0.02, 0.065]],
    review: [[587.33, 0.17, 0.06, 0.05], [739.99, 0.22, 0.02, 0.05]],
    assigned: [[493.88, 0.15, 0.05, 0.06], [659.25, 0.2, 0.02, 0.06]],
    responding: [[587.33, 0.12, 0.04, 0.075], [783.99, 0.12, 0.04, 0.075], [987.77, 0.19, 0.02, 0.075]],
    dispatch: [[523.25, 0.12, 0.035, 0.075], [659.25, 0.12, 0.035, 0.075], [783.99, 0.2, 0.02, 0.075]],
    arrival: [[659.25, 0.14, 0.05, 0.05], [784, 0.14, 0.05, 0.05], [880, 0.2, 0.02, 0.05]],
    resolved: [[783.99, 0.18, 0.07, 0.055], [1046.5, 0.28, 0.02, 0.055]],
  };
  let offset = 0;
  for (const [frequency, duration, gap, volume] of notes[kind]) {
    playTone(context, frequency, startAt + offset, duration, volume);
    offset += duration + gap;
  }
}

function unlockAudio(): void {
  const context = getAudioContext();
  if (!context) return;
  void context.resume().then(() => {
    if (pendingSound) playNow(pendingSound);
    pendingSound = null;
    if (pendingSoundTimer !== null) window.clearTimeout(pendingSoundTimer);
    pendingSoundTimer = null;
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    unlockListenersInstalled = false;
  }).catch(() => undefined);
}

export function playNotificationSound(kind: NotificationSound): void {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'running') {
    playNow(kind);
    return;
  }

  // Browsers require a user gesture before playing audio. Keep only a recent
  // notification and play it after the user next interacts with the dashboard.
  pendingSound = kind;
  if (!unlockListenersInstalled) {
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    unlockListenersInstalled = true;
  }
  if (pendingSoundTimer !== null) window.clearTimeout(pendingSoundTimer);
  pendingSoundTimer = window.setTimeout(() => {
    pendingSound = null;
    pendingSoundTimer = null;
  }, 8000);
  void context.resume().then(() => {
    if (context.state === 'running') unlockAudio();
  }).catch(() => undefined);
}
