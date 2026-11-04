// Synthesized feedback for the 1.5-second hold-to-post gesture. Sound and
// haptics are progressive enhancement; failures never affect the action.
const detents = [
  261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1568,
];

export class HoldSound {
  #audio?: AudioContext;
  #charge?: GainNode;
  #voices: OscillatorNode[] = [];

  #note(frequency: number, at: number, duration: number, volume: number) {
    if (!this.#audio) return;
    const voice = this.#audio.createOscillator(),
      envelope = this.#audio.createGain();
    voice.type = "sine";
    voice.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope).connect(this.#charge || this.#audio.destination);
    voice.start(at);
    voice.stop(at + duration + 0.02);
    if (this.#charge) this.#voices.push(voice);
  }

  /** Starts the rising swell. Call from the user's gesture. */
  start() {
    try {
      const audio = (this.#audio ??= new AudioContext());
      void audio.resume().catch(() => {});
      this.#charge = audio.createGain();
      this.#charge.gain.setValueAtTime(0, audio.currentTime);
      this.#charge.gain.linearRampToValueAtTime(0.7, audio.currentTime + 1.5);
      this.#charge.connect(audio.destination);
      // A warm octave swell under the accelerating, tuned detents.
      for (const [frequency, volume] of [
        [110, 0.07],
        [220, 0.035],
      ]) {
        const voice = audio.createOscillator(),
          level = audio.createGain();
        voice.type = "triangle";
        voice.frequency.setValueAtTime(frequency, audio.currentTime);
        voice.frequency.exponentialRampToValueAtTime(
          frequency * 4,
          audio.currentTime + 1.5,
        );
        level.gain.value = volume;
        voice.connect(level).connect(this.#charge);
        voice.start();
        this.#voices.push(voice);
      }
    } catch {
      /* Sound is progressive enhancement. */
    }
  }

  /** Plays the numbered detent (1–9) with a matching haptic tick. */
  detent(pulse: number) {
    navigator.vibrate?.(6 + pulse * 2);
    if (!this.#audio || !this.#charge) return;
    try {
      this.#note(
        detents[Math.min(pulse - 1, detents.length - 1)],
        this.#audio.currentTime,
        0.1,
        0.12,
      );
    } catch {
      /* Audio is optional. */
    }
  }

  stop() {
    if (this.#audio && this.#charge) {
      this.#charge.gain.cancelScheduledValues(this.#audio.currentTime);
      this.#charge.gain.setTargetAtTime(0, this.#audio.currentTime, 0.012);
      for (const voice of this.#voices)
        voice.stop(this.#audio.currentTime + 0.06);
    }
    this.#voices = [];
    this.#charge = undefined;
    if (typeof navigator !== "undefined") navigator.vibrate?.(0);
  }

  celebrate() {
    navigator.vibrate?.([18, 25, 45]);
    if (!this.#audio) return;
    try {
      const now = this.#audio.currentTime;
      this.#note(65.41, now, 0.3, 0.13);
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        this.#note(frequency, now + index * 0.045, 0.45, 0.085),
      );
    } catch {
      /* Feedback must never mask a successful action. */
    }
  }

  close() {
    void this.#audio?.close();
  }
}
