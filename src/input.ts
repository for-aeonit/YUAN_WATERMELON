import { CanvasRenderer } from './renderer';
import { clientToWorldFromEvent } from './utils/input';
import { VIEW } from './config';

export class Input {
	left = false;
	right = false;
	drop = false;
	axisX = 0; // -1..1

	private unsubscribeFns: (() => void)[] = [];

	constructor(private canvas: HTMLCanvasElement, private mapToWorldX: (px: number) => number, private renderer: CanvasRenderer) {
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

		const press = (ev: MouseEvent | TouchEvent) => {
			const p = clientToWorldFromEvent(ev, this.canvas, VIEW.scale);
			this.axisX = 0; // we use absolute mapping; movement handled by game
			(this as any)._lastTouchWorldX = p.x;
			// Don't drop immediately on press, wait for release
		};
		const move = (ev: MouseEvent | TouchEvent) => {
			if ((this as any)._lastTouchWorldX == null) return;
			const p = clientToWorldFromEvent(ev, this.canvas, VIEW.scale);
			(this as any)._lastTouchWorldX = p.x;
		};
		const up = () => { 
			if ((this as any)._lastTouchWorldX != null) {
				this.drop = true; // Drop on release
			}
			(this as any)._lastTouchWorldX = null; 
		};

		const md = (e: MouseEvent) => { press(e); };
		const mm = (e: MouseEvent) => { move(e); };
		const mu = () => { up(); };
		this.canvas.addEventListener('mousedown', md);
		window.addEventListener('mousemove', mm);
		window.addEventListener('mouseup', mu);
		this.unsubscribeFns.push(() => { this.canvas.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); });

		const td = (e: TouchEvent) => { if (e.changedTouches[0]) press(e); };
		const tm = (e: TouchEvent) => { if (e.changedTouches[0]) move(e); };
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


