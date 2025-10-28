import { VIEWPORT } from './renderer';

const state = {
  xWorld: VIEWPORT.worldWidth / 2,
  active: false,
  lastDropAt: 0,
};
const DROP_COOLDOWN_MS = 150;

function clientToWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();           // CSS pixels box
  const xCanvas = clientX - rect.left;                   // inside-canvas CSS px
  const yCanvas = clientY - rect.top;
  // Convert CSS px → world units using VIEWPORT.scale
  return { xWorld: xCanvas / VIEWPORT.scale, yWorld: yCanvas / VIEWPORT.scale };
}

export function attachInputHandlers(canvas: HTMLCanvasElement, onDrop:(x:number)=>void) {
  canvas.style.touchAction = 'none';
  const wallMargin = 6;

  const updateFromPointer = (e: PointerEvent) => {
    const { xWorld } = clientToWorld(canvas, e.clientX, e.clientY);
    state.xWorld = Math.max(wallMargin, Math.min(VIEWPORT.worldWidth - wallMargin, xWorld));
  };

  const tryDrop = () => {
    const now = performance.now();
    if (now - state.lastDropAt < DROP_COOLDOWN_MS) return;  // debounce
    state.lastDropAt = now;
    onDrop(state.xWorld);
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    state.active = true;
    canvas.setPointerCapture?.(e.pointerId);
    updateFromPointer(e);
  };
  const onPointerMove = (e: PointerEvent) => { updateFromPointer(e); };
  const onPointerUp   = (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    state.active = false;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
    tryDrop();                                           // drop on release
  };

  // IMPORTANT: avoid synthetic click double-fire (down/up are non-passive)
  canvas.addEventListener('pointerdown', onPointerDown, { passive:false });
  canvas.addEventListener('pointermove', onPointerMove, { passive:true });
  window.addEventListener('pointerup',   onPointerUp,   { passive:false });

  // Keyboard fallback
  window.addEventListener('keydown', (e) => {
    const step = 8;
    if (e.key === 'ArrowLeft' || e.key === 'a') state.xWorld = Math.max(wallMargin, state.xWorld - step);
    if (e.key === 'ArrowRight'|| e.key === 'd') state.xWorld = Math.min(VIEWPORT.worldWidth - wallMargin, state.xWorld + step);
    if (e.key === ' ' || e.key === 'ArrowDown') tryDrop();
  });
}

export function getPointerWorldX(){ return state.xWorld; }

// Legacy Input class for backward compatibility
export class Input {
	left = false;
	right = false;
	drop = false;
	axisX = 0; // -1..1

	private unsubscribeFns: (() => void)[] = [];

	constructor(private canvas: HTMLCanvasElement, private mapToWorldX: (px: number) => number) {
		this.init();
	}

	private init() {
		const onKey = (e: KeyboardEvent, down: boolean) => {
			if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
			if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;
			if (e.code === 'Space' || e.code === 'ArrowDown') { if (down) this.drop = true; }
		};
		const kd = (e: KeyboardEvent) => onKey(e, true);
		const ku = (e: KeyboardEvent) => onKey(e, false);
		window.addEventListener('keydown', kd, { passive: true });
		window.addEventListener('keyup', ku, { passive: true });
		this.unsubscribeFns.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });

		const press = (clientX: number) => {
			const rect = this.canvas.getBoundingClientRect();
			const x = clientX - rect.left;
			const worldX = this.mapToWorldX(x);
			this.axisX = 0; // we use absolute mapping; movement handled by game
			(this as any)._lastTouchWorldX = worldX;
			// Don't drop immediately on press, wait for release
		};
		const move = (clientX: number) => {
			if ((this as any)._lastTouchWorldX == null) return;
			const rect = this.canvas.getBoundingClientRect();
			const x = clientX - rect.left;
			const worldX = this.mapToWorldX(x);
			(this as any)._lastTouchWorldX = worldX;
		};
		const up = () => { 
			if ((this as any)._lastTouchWorldX != null) {
				this.drop = true; // Drop on release
			}
			(this as any)._lastTouchWorldX = null; 
		};

		const md = (e: MouseEvent) => { press(e.clientX); };
		const mm = (e: MouseEvent) => { move(e.clientX); };
		const mu = () => { up(); };
		this.canvas.addEventListener('mousedown', md);
		window.addEventListener('mousemove', mm);
		window.addEventListener('mouseup', mu);
		this.unsubscribeFns.push(() => { this.canvas.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); });

		const td = (e: TouchEvent) => { if (e.changedTouches[0]) press(e.changedTouches[0].clientX); };
		const tm = (e: TouchEvent) => { if (e.changedTouches[0]) move(e.changedTouches[0].clientX); };
		const tu = () => { up(); };
		this.canvas.addEventListener('touchstart', td, { passive: true });
		this.canvas.addEventListener('touchmove', tm, { passive: true });
		this.canvas.addEventListener('touchend', tu, { passive: true });
		this.unsubscribeFns.push(() => { this.canvas.removeEventListener('touchstart', td); this.canvas.removeEventListener('touchmove', tm); this.canvas.removeEventListener('touchend', tu); });
	}

	consumeDrop(): boolean { const d = this.drop; this.drop = false; return d; }
	getTouchWorldX(): number | null { return (this as any)._lastTouchWorldX ?? null; }

	dispose() { this.unsubscribeFns.forEach(fn => fn()); }
}


