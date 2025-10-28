import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const canvasWrap = document.getElementById('canvas-wrap') as HTMLDivElement;
const btnPause = document.getElementById('btn-pause') as HTMLDivElement;
const btnRestart = document.getElementById('btn-restart') as HTMLDivElement;
const btnDialogRestart = document.getElementById('btn-dialog-restart') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLDivElement;

const game = new Game(canvas);

// Responsive canvas handling
function resizeCanvas() {
	const containerRect = canvasWrap.getBoundingClientRect();
	const containerAspect = containerRect.width / containerRect.height;
	const gameAspect = 540 / 960; // WORLD.logicalWidth / WORLD.logicalHeight
	
	let canvasWidth: number;
	let canvasHeight: number;
	
	if (containerAspect > gameAspect) {
		// Container is wider than game aspect ratio - fit height
		canvasHeight = containerRect.height;
		canvasWidth = canvasHeight * gameAspect;
	} else {
		// Container is taller than game aspect ratio - fit width
		canvasWidth = containerRect.width;
		canvasHeight = canvasWidth / gameAspect;
	}
	
	canvas.width = canvasWidth;
	canvas.height = canvasHeight;
	canvas.style.width = `${canvasWidth}px`;
	canvas.style.height = `${canvasHeight}px`;
	
	// Update game renderer with new dimensions
	game.resizeCanvas(canvasWidth, canvasHeight);
}

// Set up resize listeners
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
	// Delay resize to allow orientation change to complete
	setTimeout(resizeCanvas, 100);
});

// Initial resize
resizeCanvas();

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


