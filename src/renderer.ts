import { TIER_CONFIG, WORLD, resolveAsset } from './config';

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
	private scale = 1;
	private offsetX = 0;
	private offsetY = 0;

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
		const promises = TIER_CONFIG.map(async (tier, index) => {
			const img = new Image();
			img.src = tier.img;
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error(`Failed to load image: ${tier.img}`));
			});
			this.images.set(index, img);
		});
		await Promise.all(promises);
	}

	canvasPxToWorldX(px: number): number {
		return (px - this.offsetX) / this.scale;
	}

	resizeToFit(container: HTMLElement): void {
		const containerRect = container.getBoundingClientRect();
		const containerAspect = containerRect.width / containerRect.height;
		const gameAspect = WORLD.logicalWidth / WORLD.logicalHeight;

		let canvasWidth: number;
		let canvasHeight: number;

		if (containerAspect > gameAspect) {
			canvasHeight = containerRect.height;
			canvasWidth = canvasHeight * gameAspect;
		} else {
			canvasWidth = containerRect.width;
			canvasHeight = canvasWidth / gameAspect;
		}

		this.canvas.width = canvasWidth;
		this.canvas.height = canvasHeight;
		this.canvas.style.width = `${canvasWidth}px`;
		this.canvas.style.height = `${canvasHeight}px`;

		this.scale = canvasWidth / WORLD.logicalWidth;
		this.offsetX = (containerRect.width - canvasWidth) / 2;
		this.offsetY = (containerRect.height - canvasHeight) / 2;

		const barTop = document.getElementById('bar-top') as HTMLElement;
		const barBottom = document.getElementById('bar-bottom') as HTMLElement;
		
		if (containerAspect > gameAspect) {
			const barHeight = (containerRect.height - canvasHeight) / 2;
			barTop.style.height = `${barHeight}px`;
			barBottom.style.height = `${barHeight}px`;
		} else {
			barTop.style.height = '0px';
			barBottom.style.height = '0px';
		}
	}

	clear(): void {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	drawWorldBounds(width: number, height: number): void {
		this.ctx.save();
		this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		this.ctx.lineWidth = 2;
		this.ctx.strokeRect(0, 0, width, height);
		this.ctx.restore();
	}

	drawBodies(bodies: RenderableBody[]): void {
		this.ctx.save();
		
		for (const body of bodies) {
			const img = this.images.get(body.tierIndex);
			if (!img) {
				this.ctx.fillStyle = this.getFruitColor(body.tierIndex);
				this.ctx.beginPath();
				this.ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2);
				this.ctx.fill();
				continue;
			}

			this.ctx.save();
			this.ctx.translate(body.x, body.y);
			this.ctx.rotate(body.angle);
			
			const size = body.r * 2;
			this.ctx.drawImage(img, -body.r, -body.r, size, size);
			
			this.ctx.restore();
		}
		
		this.ctx.restore();
	}

	drawDropper(x: number, tierIndex: number): void {
		const img = this.images.get(tierIndex);
		if (!img) {
			this.ctx.save();
			this.ctx.globalAlpha = 0.6;
			this.ctx.fillStyle = this.getFruitColor(tierIndex);
			this.ctx.beginPath();
			this.ctx.arc(x, WORLD.spawnY, TIER_CONFIG[tierIndex].radius, 0, Math.PI * 2);
			this.ctx.fill();
			this.ctx.restore();
			return;
		}

		this.ctx.save();
		this.ctx.globalAlpha = 0.6;
		
		const radius = TIER_CONFIG[tierIndex].radius;
		const size = radius * 2;
		this.ctx.drawImage(img, x - radius, WORLD.spawnY - radius, size, size);
		
		this.ctx.restore();
	}

	drawEffects(effects: { x: number; y: number; t: number; duration: number }[]): void {
		this.ctx.save();
		
		for (const effect of effects) {
			const progress = effect.t / effect.duration;
			const alpha = 1 - progress;
			const scale = 1 + progress * 0.5;
			
			this.ctx.globalAlpha = alpha;
			this.ctx.fillStyle = '#ffffff';
			this.ctx.beginPath();
			this.ctx.arc(effect.x, effect.y, 8 * scale, 0, Math.PI * 2);
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
