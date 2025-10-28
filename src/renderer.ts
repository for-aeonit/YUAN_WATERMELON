import { TIER_CONFIG, WORLD, VIEW } from './config';
import { resolveAsset } from './utils/resolveAsset';

export interface RenderableBody {
	id: number;
	x: number;
	y: number;
	r: number;
	angle: number;
	tierIndex: number;
}

export class CanvasRenderer {
	private ctx: CanvasRenderingContext2D;
	private images: Map<number, HTMLImageElement> = new Map();
	private previewCtx: CanvasRenderingContext2D;
	private backgroundImage: HTMLImageElement | null = null;

	constructor(private canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not get 2D context');
		this.ctx = ctx;

		const previewCanvas = document.getElementById('preview') as HTMLCanvasElement;
		const previewCtx = previewCanvas.getContext('2d');
		if (!previewCtx) throw new Error('Could not get preview 2D context');
		this.previewCtx = previewCtx;
	}

	async loadImages(): Promise<void> {
		// Load background image
		const bgPromise = new Promise<void>((resolve, reject) => {
			const img = new Image();
			img.src = resolveAsset('background/bg_01.png');
			img.onload = () => {
				this.backgroundImage = img;
				resolve();
			};
			img.onerror = () => reject(new Error(`Failed to load background image: background/bg_01.png`));
		});

		// Load tier images
		const tierPromises = TIER_CONFIG.map(async (tier, index) => {
			const img = new Image();
			img.src = resolveAsset(tier.img);
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error(`Failed to load image: ${tier.img}`));
			});
			this.images.set(index, img);
		});

		await Promise.all([bgPromise, ...tierPromises]);
	}

	resizeCanvas(): void {
		const dpr = Math.max(1, window.devicePixelRatio || 1);
		const wrap = document.querySelector('.game-wrap');
		const rect = wrap!.getBoundingClientRect();
		const vw = Math.max(1, rect.width), vh = Math.max(1, rect.height);
		const aspect = VIEW.worldW / VIEW.worldH; // 9/16

		let cssW = vw, cssH = Math.floor(vw / aspect);
		if (cssH > vh) { cssH = vh; cssW = Math.floor(vh * aspect); }

		this.canvas.style.width = cssW + 'px';
		this.canvas.style.height = cssH + 'px';
		this.canvas.width = Math.round(cssW * dpr);
		this.canvas.height = Math.round(cssH * dpr);

		VIEW.scale = this.canvas.width / VIEW.worldW;   // device px per world unit
		VIEW.offsetX = (vw - cssW) / 2;
		VIEW.offsetY = (vh - cssH) / 2;
	}

	canvasPxToWorldX(px: number): number {
		return px / VIEW.scale;
	}

	canvasPxToWorldY(py: number): number {
		return py / VIEW.scale;
	}

	clientToWorldFromEvent(event: MouseEvent | TouchEvent): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const cx = ('touches' in event && event.touches?.length) ? event.touches[0].clientX : (event as MouseEvent).clientX;
		const cy = ('touches' in event && event.touches?.length) ? event.touches[0].clientY : (event as MouseEvent).clientY;
		const xCss = cx - rect.left;
		const yCss = cy - rect.top;
		return { x: xCss / VIEW.scale, y: yCss / VIEW.scale };
	}


	clear(): void {
		if (this.backgroundImage) {
			this.ctx.drawImage(this.backgroundImage, 0, 0, this.canvas.width, this.canvas.height);
		} else {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		}
	}

	drawWorldBounds(): void {
		this.ctx.save();
		this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		this.ctx.lineWidth = 2;
		this.ctx.strokeRect(0, 0, WORLD.width * VIEW.scale, WORLD.height * VIEW.scale);
		this.ctx.restore();
	}

	drawGameOverLine(): void {
		this.ctx.save();
		this.ctx.strokeStyle = 'red';
		this.ctx.lineWidth = 2;
		const y = WORLD.gameOverLineY * VIEW.scale;
		this.ctx.beginPath();
		this.ctx.moveTo(0, y);
		this.ctx.lineTo(this.canvas.width, y);
		this.ctx.stroke();
		this.ctx.restore();
	}

	drawBodies(bodies: RenderableBody[]): void {
		this.ctx.save();
		
		for (const body of bodies) {
			const img = this.images.get(body.tierIndex);
			const x = body.x * VIEW.scale;
			const y = body.y * VIEW.scale;
			const r = body.r * VIEW.scale;
			
			if (!img) {
				this.ctx.fillStyle = this.getFruitColor(body.tierIndex);
				this.ctx.beginPath();
				this.ctx.arc(x, y, r, 0, Math.PI * 2);
				this.ctx.fill();
				continue;
			}

			this.ctx.save();
			this.ctx.translate(x, y);
			this.ctx.rotate(body.angle);
			
			const size = r * 2;
			this.ctx.drawImage(img, -r, -r, size, size);
			
			this.ctx.restore();
		}
		
		this.ctx.restore();
	}

	drawDropper(x: number, tierIndex: number): void {
		const img = this.images.get(tierIndex);
		const worldX = x * VIEW.scale;
		const worldY = WORLD.spawnY * VIEW.scale;
		const radius = TIER_CONFIG[tierIndex].radius * VIEW.scale;
		
		if (!img) {
			this.ctx.save();
			this.ctx.globalAlpha = 0.6;
			this.ctx.fillStyle = this.getFruitColor(tierIndex);
			this.ctx.beginPath();
			this.ctx.arc(worldX, worldY, radius, 0, Math.PI * 2);
			this.ctx.fill();
			this.ctx.restore();
			return;
		}

		this.ctx.save();
		this.ctx.globalAlpha = 0.6;
		
		const size = radius * 2;
		this.ctx.drawImage(img, worldX - radius, worldY - radius, size, size);
		
		this.ctx.restore();
	}

	drawEffects(effects: { x: number; y: number; t: number; duration: number }[]): void {
		this.ctx.save();
		
		for (const effect of effects) {
			const progress = effect.t / effect.duration;
			const alpha = 1 - progress;
			const scale = 1 + progress * 0.5;
			const x = effect.x * VIEW.scale;
			const y = effect.y * VIEW.scale;
			
			this.ctx.globalAlpha = alpha;
			this.ctx.fillStyle = '#ffffff';
			this.ctx.beginPath();
			this.ctx.arc(x, y, 8 * scale * VIEW.scale, 0, Math.PI * 2);
			this.ctx.fill();
		}
		
		this.ctx.restore();
	}

	updatePreview(tierIndex: number): void {
		const img = this.images.get(tierIndex);
		if (!img) {
			this.previewCtx.fillStyle = this.getFruitColor(tierIndex);
			this.previewCtx.beginPath();
			this.previewCtx.arc(32, 32, 24, 0, Math.PI * 2);
			this.previewCtx.fill();
			return;
		}

		this.previewCtx.clearRect(0, 0, 64, 64);
		this.previewCtx.drawImage(img, 0, 0, 64, 64);
	}

	private getFruitColor(tierIndex: number): string {
		const colors = [
			'#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
			'#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
			'#ff6348'
		];
		return colors[tierIndex % colors.length];
	}
}
