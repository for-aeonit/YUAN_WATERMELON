import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const btnPause = document.getElementById('btn-pause') as HTMLDivElement;
const btnRestart = document.getElementById('btn-restart') as HTMLDivElement;
const btnDialogRestart = document.getElementById('btn-dialog-restart') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLDivElement;

const game = new Game(canvas);

// buttons
let paused = false;
btnPause.addEventListener('click', () => {
	paused = !paused; game.setPaused(paused); btnPause.textContent = paused ? '▶' : '⏸';
});

btnRestart.addEventListener('click', () => { game.restart(); });
btnDialogRestart.addEventListener('click', () => { game.restart(); });

// sound button reflects persisted state
let muted = false;
try { muted = localStorage.getItem('sound-muted') === '1'; } catch {}
btnSound.textContent = muted ? '🔈' : '🔊';
btnSound.addEventListener('click', () => {
	muted = !muted; game.setMuted(muted); btnSound.textContent = muted ? '🔈' : '🔊';
});

// unlock audio on first interaction
window.addEventListener('pointerdown', () => { (game as any).audio?.unlock?.(); }, { once: true, passive: true });

// drop via tap/space
window.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); }, { passive: false });

game.start();


