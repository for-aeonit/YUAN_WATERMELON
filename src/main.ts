import { Game } from './game';
import { attachInputHandlers } from './input';
import { CanvasRenderer } from './renderer';

let started = false;
let game: Game | null = null;

function resizeCanvas(canvas: HTMLCanvasElement) {
	const container = document.getElementById('canvas-wrap')!;
	const renderer = new CanvasRenderer(canvas);
	renderer.resizeToFit(container);
}

async function startGame(canvas: HTMLCanvasElement) {
	if (game) return; // prevent double init
	
	game = new Game(canvas);
	
	// Setup input handlers
	attachInputHandlers(canvas, (x: number) => {
		window.dispatchEvent(new CustomEvent('DROP_REQUESTED', { detail: { x } }));
	});
	
	// Setup UI buttons
	const btnPause = document.getElementById('btn-pause') as HTMLDivElement;
	const btnRestart = document.getElementById('btn-restart') as HTMLDivElement;
	const btnDialogRestart = document.getElementById('btn-dialog-restart') as HTMLButtonElement;
	const btnSound = document.getElementById('btn-sound') as HTMLDivElement;

	let paused = false;
	btnPause.addEventListener('click', () => {
		paused = !paused; game!.setPaused(paused); btnPause.textContent = paused ? '▶' : '⏸';
	});

	btnRestart.addEventListener('click', () => { game!.restart(); });
	btnDialogRestart.addEventListener('click', () => { game!.restart(); });

	// sound button reflects persisted state
	let muted = false;
	try { muted = localStorage.getItem('sound-muted') === '1'; } catch {}
	btnSound.textContent = muted ? '🔈' : '🔊';
	btnSound.addEventListener('click', () => {
		muted = !muted; game!.setMuted(muted); btnSound.textContent = muted ? '🔈' : '🔊';
	});

	// Handle drop events
	window.addEventListener('DROP_REQUESTED', (e: any) => {
		if (game && !game.getMuted()) {
			(game as any).dropFruit();
		}
	});

	// drop via space
	window.addEventListener('keydown', (e) => { 
		if (e.code === 'Space') {
			e.preventDefault(); 
			if (game && !game.getMuted()) {
				(game as any).dropFruit();
			}
		}
	}, { passive: false });

	await game.start();
	started = true;
}

async function boot() {
	if (started) return;
	const canvas = document.getElementById('game') as HTMLCanvasElement;
	if (!canvas) return;

	resizeCanvas(canvas);
	await startGame(canvas);
}

function unlockAudioOnce(){
	const resume = async () => {
		// Audio unlock handled by game
		if (!started) boot();   // guarantee game starts properly after first gesture
		window.removeEventListener('pointerdown', resume);
		window.removeEventListener('keydown', resume);
		window.removeEventListener('touchstart', resume);
	};
	window.addEventListener('pointerdown', resume, { once:true });
	window.addEventListener('keydown',   resume, { once:true });
	window.addEventListener('touchstart',resume, { once:true, passive:true });
}

// Handle resize and orientation changes
window.addEventListener('resize', () => {
	const canvas = document.getElementById('game') as HTMLCanvasElement;
	if (canvas) resizeCanvas(canvas);
});

window.addEventListener('orientationchange', () => {
	const canvas = document.getElementById('game') as HTMLCanvasElement;
	if (canvas) setTimeout(() => resizeCanvas(canvas), 120);
});

window.addEventListener('DOMContentLoaded', () => {
	boot();            // try to start immediately
	unlockAudioOnce(); // ensure audio policies are respected and start again on first gesture
});


