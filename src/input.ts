export class Input {
	left = false;
	right = false;
	drop = false;
	axisX = 0; // -1..1

	private unsubscribeFns: (() => void)[] = [];

	constructor(private canvas: HTMLCanvasElement) {
		this.init();
	}

	private clientToWorldFromEvent(ev: MouseEvent | TouchEvent): { x: number; y: number } {
		const c = this.canvas;
		const r = c.getBoundingClientRect();
		const cx = ('touches' in ev && ev.touches?.length) ? ev.touches[0].clientX : (ev as MouseEvent).clientX;
		const cy = ('touches' in ev && ev.touches?.length) ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
		const xCss = cx - r.left;  // position inside the visible canvas area
		const yCss = cy - r.top;
		return { x: xCss, y: yCss };
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
			const coords = this.clientToWorldFromEvent(ev);
			this.axisX = 0; // we use absolute mapping; movement handled by game
			(this as any)._lastTouchCoords = coords;
			// Don't drop immediately on press, wait for release
		};
		const move = (ev: MouseEvent | TouchEvent) => {
			if ((this as any)._lastTouchCoords == null) return;
			const coords = this.clientToWorldFromEvent(ev);
			(this as any)._lastTouchCoords = coords;
		};
		const up = () => { 
			if ((this as any)._lastTouchCoords != null) {
				this.drop = true; // Drop on release
			}
			(this as any)._lastTouchCoords = null; 
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
	getTouchCoords(): { x: number; y: number } | null { return (this as any)._lastTouchCoords ?? null; }

	dispose() { this.unsubscribeFns.forEach(fn => fn()); }
}


