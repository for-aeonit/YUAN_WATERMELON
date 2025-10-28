export type SoundKey = 'pop' | 'land' | 'gameover';

type ToneSpec = { freq: number; duration: number; type?: OscillatorType; gain?: number };

export class AudioManager {
	private ctx: AudioContext | null = null;
	private muted = false;
	private unlocked = false;

	constructor() {
		try {
			this.muted = localStorage.getItem('sound-muted') === '1';
		} catch {}
	}

	get isMuted() { return this.muted; }

	setMuted(m: boolean) {
		this.muted = m;
		try { localStorage.setItem('sound-muted', m ? '1' : '0'); } catch {}
	}

	private ensureContext() {
		if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
	}

	unlock() {
		if (this.unlocked) return;
		this.ensureContext();
		// play a tiny silent buffer
		const ctx = this.ctx!;
		const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
		const src = ctx.createBufferSource();
		src.buffer = buf; src.connect(ctx.destination); src.start(0);
		this.unlocked = true;
	}

	play(key: SoundKey) {
		if (this.muted) return;
		this.ensureContext();
		switch (key) {
			case 'pop': this.tone({ freq: 880, duration: 0.06, type: 'square', gain: 0.06 }); break;
			case 'land': this.tone({ freq: 180, duration: 0.08, type: 'triangle', gain: 0.08 }); break;
			case 'gameover': this.chirp(520, 120, 0.35); break;
		}
	}

	private tone(spec: ToneSpec) {
		const ctx = this.ctx!;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = spec.type ?? 'sine';
		osc.frequency.value = spec.freq;
		gain.gain.value = spec.gain ?? 0.08;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + spec.duration);
		osc.stop(ctx.currentTime + spec.duration + 0.02);
	}

	private chirp(startFreq: number, durationMs: number, gainVal: number) {
		const ctx = this.ctx!;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sawtooth';
		osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
		osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + durationMs / 1000);
		gain.gain.value = gainVal;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
		osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
	}
}


