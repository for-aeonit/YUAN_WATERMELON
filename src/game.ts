import Matter, { Engine, World, Bodies, Body, Composite, Events, Detector } from 'matter-js';
import { TIER_CONFIG, WORLD, PHYSICS, SCORING } from './config';
import { CanvasRenderer, RenderableBody } from './renderer';
import { Input } from './input';
import { AudioManager } from './audio';

type FruitBody = Body & { plugin: { tierIndex: number; merging?: boolean } };

export class Game {
	private engine: Engine;
	private renderer: CanvasRenderer;
	private input: Input;
	private audio: AudioManager;
	private world: World;
	private bodies: FruitBody[] = [];
	private ground!: Body; private leftWall!: Body; private rightWall!: Body; private ceiling!: Body;
	private nextTierIndex = 0;
	private dropperX = WORLD.logicalWidth / 2;
	private score = 0;
	private best = 0;
	private comboCount = 0;
	private lastMergeTime = 0;
	private gameOver = false;
	private overTimer = 0;
	private paused = false;
	private effects: { x: number; y: number; t: number; duration: number }[] = [];

	constructor(private canvas: HTMLCanvasElement) {
		this.engine = Engine.create({ gravity: { x: 0, y: PHYSICS.gravityY, scale: 0.001 } });
		this.world = this.engine.world;
		this.renderer = new CanvasRenderer(canvas);
		this.input = new Input(canvas, (px) => this.renderer.canvasPxToWorldX(px));
		this.audio = new AudioManager();
		try { this.best = Number(localStorage.getItem('best-score') || '0') || 0; } catch {}
	}

	async init() {
		await this.renderer.loadImages();
		this.resetWorldBounds();
		this.wireEvents();
		this.rollNext();
		this.updateHUD();
	}

	private resetWorldBounds() {
		Composite.clear(this.world, false, true);
		this.bodies = [];
		const W = WORLD.logicalWidth, H = WORLD.logicalHeight, T = WORLD.wallThickness;
		const halfW = W / 2;
		// Ground - positioned at the bottom of the world
		this.ground = Bodies.rectangle(halfW, H - T/2, W, T, { isStatic: true, friction: 0.3, restitution: 0.1 });
		// Left wall
		this.leftWall = Bodies.rectangle(-T/2, H/2, T, H, { isStatic: true, friction: 0.1 });
		// Right wall  
		this.rightWall = Bodies.rectangle(W + T/2, H/2, T, H, { isStatic: true, friction: 0.1 });
		// Ceiling (invisible sensor)
		this.ceiling = Bodies.rectangle(halfW, -T/2, W, T, { isStatic: true, isSensor: true });
		World.add(this.world, [this.ground, this.leftWall, this.rightWall, this.ceiling]);
	}

	private wireEvents() {
		Events.on(this.engine, 'collisionStart', (ev) => {
			for (const pair of ev.pairs) {
				const a = pair.bodyA as FruitBody; const b = pair.bodyB as FruitBody;
				if ((a as any).plugin?.tierIndex != null && (b as any).plugin?.tierIndex != null) {
					this.tryMerge(a, b);
				} else {
					// land sound when fruit hits ground or wall
					if (((a as any).plugin?.tierIndex != null) || ((b as any).plugin?.tierIndex != null)) this.audio.play('land');
				}
			}
		});
	}

	private tryMerge(a: FruitBody, b: FruitBody) {
		if (a.plugin.tierIndex !== b.plugin.tierIndex) return;
		if (a.plugin.merging || b.plugin.merging) return;
		// gentle touch: relative speed small
		const relVx = a.velocity.x - b.velocity.x; const relVy = a.velocity.y - b.velocity.y;
		const relSpeed2 = relVx*relVx + relVy*relVy;
		if (relSpeed2 > 6) return; // heuristic threshold
		const tier = a.plugin.tierIndex;
		if (tier >= TIER_CONFIG.length - 1) return;
		a.plugin.merging = b.plugin.merging = true;
		const posX = (a.position.x + b.position.x) / 2;
		const posY = (a.position.y + b.position.y) / 2;
		// remove both and spawn next tier with a pop effect
		World.remove(this.world, a);
		World.remove(this.world, b);
		this.bodies = this.bodies.filter(x => x !== a && x !== b);
		const next = this.createFruit(tier + 1, posX, posY - 6);
		// burst upward slightly
		Body.setVelocity(next, { x: 0, y: -3 });
		this.audio.play('pop');
		// visual effect
		this.effects.push({ x: posX, y: posY, t: 0, duration: 300 });
		// scoring and combo
		const now = performance.now();
		if (now - this.lastMergeTime <= SCORING.comboWindowMs) this.comboCount++; else this.comboCount = 1;
		this.lastMergeTime = now;
		const gained = (SCORING.mergeBase * (tier + 1)) * this.comboCount;
		this.score += Math.floor(gained);
		if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('best-score', String(this.best)); } catch {} }
		this.updateHUD();
	}

	private createFruit(tierIndex: number, x: number, y: number): FruitBody {
		const cfg = TIER_CONFIG[tierIndex];
		const body = Bodies.circle(x, y, cfg.radius, {
			restitution: PHYSICS.restitution,
			friction: PHYSICS.friction,
			frictionAir: 0.002,
			mass: cfg.mass,
		}) as FruitBody;
		(body as any).plugin = { tierIndex };
		World.add(this.world, body);
		this.bodies.push(body);
		return body;
	}

	private rollNext() {
		// early tiers more likely
		const maxStartTier = Math.min(4, TIER_CONFIG.length - 2);
		const weights = Array.from({ length: maxStartTier + 1 }, (_, i) => 1 / (i + 1));
		const sum = weights.reduce((a, b) => a + b, 0);
		let r = Math.random() * sum;
		let idx = 0;
		for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
		this.nextTierIndex = idx;
		this.renderer.updatePreview(this.nextTierIndex);
	}

	private updateHUD() {
		const s = document.getElementById('score')!; s.textContent = `Score: ${this.score}`;
		const b = document.getElementById('best')!; b.textContent = `Best: ${this.best}`;
	}

	private dropFruit() {
		if (this.gameOver || this.paused) return;
		const tier = this.nextTierIndex;
		this.createFruit(tier, this.dropperX, WORLD.spawnY);
		this.rollNext();
	}

	private updateGameOver(dt: number) {
		let anyOver = false;
		for (const b of this.bodies) {
			if (b.position.y - TIER_CONFIG[b.plugin.tierIndex].radius < WORLD.maxHeightY) { anyOver = true; break; }
		}
		if (anyOver) {
			this.overTimer += dt;
			if (this.overTimer >= 1000 && !this.gameOver) {
				this.triggerGameOver();
			}
		} else {
			this.overTimer = 0;
		}
	}

	private triggerGameOver() {
		this.gameOver = true;
		this.audio.play('gameover');
		const dialog = document.getElementById('dialog')!; dialog.classList.remove('hidden');
	}

	restart() {
		this.gameOver = false; this.overTimer = 0; this.score = 0; this.comboCount = 0; this.lastMergeTime = 0;
		this.resetWorldBounds(); this.rollNext(); this.updateHUD();
		const dialog = document.getElementById('dialog')!; dialog.classList.add('hidden');
	}

	setPaused(p: boolean) { this.paused = p; }
	setMuted(m: boolean) { this.audio.setMuted(m); }
	getMuted(): boolean { return this.audio.isMuted; }

	async start() {
		await this.init();
		const container = document.getElementById('canvas-wrap')!;
		const resize = () => this.renderer.resizeToFit(container);
		resize();
		window.addEventListener('resize', resize);
		// fixed timestep loop at 60Hz
		let acc = 0; let last = performance.now();
		const step = 1000/60;
		const tick = () => {
			const now = performance.now(); let dt = now - last; last = now;
			acc += dt; if (acc > 1000) acc = 1000; // spiral of death cap
			const touchX = this.input.getTouchWorldX();
			if (touchX != null) this.dropperX = Math.max(TIER_CONFIG[0].radius + 4, Math.min(WORLD.logicalWidth - TIER_CONFIG[0].radius - 4, touchX));
			else {
				const speed = 420; // px/s
				const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
				this.dropperX = Math.max(TIER_CONFIG[0].radius + 4, Math.min(WORLD.logicalWidth - TIER_CONFIG[0].radius - 4, this.dropperX + dir * (dt/1000) * speed));
			}
			if (this.input.consumeDrop()) this.dropFruit();
			if (!this.paused && !this.gameOver) {
				while (acc >= step) { Engine.update(this.engine, step); acc -= step; }
				this.updateGameOver(dt);
			}
			// update effects
			this.effects.forEach(e => e.t += dt);
			this.effects = this.effects.filter(e => e.t < e.duration);
			// render
			this.renderer.clear();
			const renderables: RenderableBody[] = this.bodies.map(b => ({ id: b.id, x: b.position.x, y: b.position.y, r: TIER_CONFIG[b.plugin.tierIndex].radius, angle: b.angle, tierIndex: b.plugin.tierIndex }));
			this.renderer.drawWorldBounds(WORLD.logicalWidth, WORLD.logicalHeight);
			this.renderer.drawBodies(renderables);
			this.renderer.drawDropper(this.dropperX, this.nextTierIndex);
			this.renderer.drawEffects(this.effects);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}
}


