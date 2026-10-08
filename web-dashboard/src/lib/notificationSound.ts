type NotificationSound = 'incident' | 'assistance';

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

  if (kind === 'incident') {
    // A short alternating alert makes a new emergency report easy to notice.
    playTone(context, 880, startAt, 0.16, 0.09);
    playTone(context, 660, startAt + 0.22, 0.16, 0.09);
    playTone(context, 880, startAt + 0.44, 0.2, 0.09);
    return;
  }

  // A gentler rising pair suits a responder's request for assistance.
  playTone(context, 659.25, startAt, 0.16, 0.055);
  playTone(context, 880, startAt + 0.2, 0.24, 0.055);
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
