import Matter, { Engine, World, Bodies, Body, Composite, Events, Detector, Query } from 'matter-js';
import { TIER_CONFIG, WORLD, PHYSICS, SCORING, VIEW, getFruitRadius } from './config';
import { CanvasRenderer, RenderableBody } from './renderer';
import { Input } from './input';
import { AudioManager } from './audio';
import { MERGE_EPSILON_RATIO, MERGE_COOLDOWN_MS, MERGE_MAX_REL_V } from './game/merge';

type FruitBody = Body & { 
	plugin: { tierIndex: number; merging?: boolean };
	fruit: { tier: number; radius: number; lastMergeAt: number | null };
};

interface MergePair {
	a: FruitBody;
	b: FruitBody;
}

class MergeManager {
	private mergeCandidates: MergePair[] = [];
	private mergedThisFrame = new Set<number>();

	collectCandidates(bodies: FruitBody[], world: World, engine: Engine) {
		this.mergeCandidates = [];
		this.mergedThisFrame.clear();

		// Collect from collision events
		Events.on(engine, 'collisionStart', (ev) => {
			for (const pair of ev.pairs) {
				const a = pair.bodyA as FruitBody;
				const b = pair.bodyB as FruitBody;
				if (this.isValidMergePair(a, b)) {
					this.mergeCandidates.push({ a, b });
				}
			}
		});

		Events.on(engine, 'collisionActive', (ev) => {
			for (const pair of ev.pairs) {
				const a = pair.bodyA as FruitBody;
				const b = pair.bodyB as FruitBody;
				if (this.isValidMergePair(a, b)) {
					this.mergeCandidates.push({ a, b });
				}
			}
		});

		// Backup proximity scan
		for (const body of bodies) {
			if (body.fruit?.tier == null) continue;
			
			const searchRadius = body.fruit.radius * 2;
			const region = {
				min: { x: body.position.x - searchRadius, y: body.position.y - searchRadius },
				max: { x: body.position.x + searchRadius, y: body.position.y + searchRadius }
			};
			
			const nearby = Query.region(world.bodies, region);
			for (const other of nearby) {
				const otherBody = other as FruitBody;
				if (otherBody !== body && this.isValidMergePair(body, otherBody)) {
					this.mergeCandidates.push({ a: body, b: otherBody });
				}
			}
		}
	}

	private isValidMergePair(a: FruitBody, b: FruitBody): boolean {
		if (!a.fruit || !b.fruit) return false;
		if (a.fruit.tier !== b.fruit.tier) return false;
		if (a.plugin?.merging || b.plugin?.merging) return false;
		
		const now = performance.now();
		if (a.fruit.lastMergeAt && (now - a.fruit.lastMergeAt) < MERGE_COOLDOWN_MS) return false;
		if (b.fruit.lastMergeAt && (now - b.fruit.lastMergeAt) < MERGE_COOLDOWN_MS) return false;

		const rMin = Math.min(a.fruit.radius, b.fruit.radius);
		const mergeEps = rMin * MERGE_EPSILON_RATIO;
		const dist = Math.sqrt(
			(a.position.x - b.position.x) ** 2 + 
			(a.position.y - b.position.y) ** 2
		);
		const needOverlap = (a.fruit.radius + b.fruit.radius) - mergeEps;
		
		const relVx = a.velocity.x - b.velocity.x;
		const relVy = a.velocity.y - b.velocity.y;
		const relV = Math.sqrt(relVx * relVx + relVy * relVy);

		return dist <= needOverlap && relV <= MERGE_MAX_REL_V;
	}

	process(world: World, bodies: FruitBody[], createFruit: (tier: number, x: number, y: number, vx: number, vy: number) => FruitBody, removeFruitBody: (body: FruitBody) => void): boolean {
		let hasMerges = false;
		
		while (true) {
			const pairs: MergePair[] = [];
			const usedBodies = new Set<number>();

			// Build unique, non-overlapping merge pairs
			for (const pair of this.mergeCandidates) {
				if (usedBodies.has(pair.a.id) || usedBodies.has(pair.b.id)) continue;
				if (this.mergedThisFrame.has(pair.a.id) || this.mergedThisFrame.has(pair.b.id)) continue;
				if (pair.a.plugin?.merging || pair.b.plugin?.merging) continue;

				const now = performance.now();
				if (pair.a.fruit.lastMergeAt && (now - pair.a.fruit.lastMergeAt) < MERGE_COOLDOWN_MS) continue;
				if (pair.b.fruit.lastMergeAt && (now - pair.b.fruit.lastMergeAt) < MERGE_COOLDOWN_MS) continue;

				// Prefer smaller bodyId to avoid conflicts
				const smallerId = Math.min(pair.a.id, pair.b.id);
				if (usedBodies.has(smallerId)) continue;

				pairs.push(pair);
				usedBodies.add(pair.a.id);
				usedBodies.add(pair.b.id);
			}

			if (pairs.length === 0) break;

			// Process all pairs in this iteration
			for (const pair of pairs) {
				const { a, b } = pair;
				const tier = a.fruit.tier;
				const newTier = tier + 1;

				if (newTier >= TIER_CONFIG.length) continue;

				const x = (a.position.x + b.position.x) / 2;
				const y = (a.position.y + b.position.y) / 2;
				const vx = (a.velocity.x + b.velocity.x) / 2;
				const vy = (a.velocity.y + b.velocity.y) / 2;

				// Remove old bodies AFTER creating new to avoid gaps
				removeFruitBody(a);
				removeFruitBody(b);

				// Create new fruit with same coordinate space and new tier
				const newFruit = createFruit(newTier, x, y, vx, vy);
				newFruit.fruit.lastMergeAt = performance.now();

				// Mark as merged this frame
				this.mergedThisFrame.add(a.id);
				this.mergedThisFrame.add(b.id);
				this.mergedThisFrame.add(newFruit.id);

				hasMerges = true;
			}
		}

		return hasMerges;
	}
}

export class Game {
	private engine: Engine;
	private renderer: CanvasRenderer;
	private input: Input;
	private audio: AudioManager;
	private world: World;
	private bodies: FruitBody[] = [];
	private ground!: Body; private leftWall!: Body; private rightWall!: Body; private ceiling!: Body;
	private nextTierIndex = 0;
	private dropperX = WORLD.width / 2;
	private score = 0;
	private best = 0;
	private comboCount = 0;
	private lastMergeTime = 0;
	private gameOver = false;
	private overTimer = 0;
	private paused = false;
	private effects: { x: number; y: number; t: number; duration: number }[] = [];
	private hasDroppedFruit = false; // guard to prevent instant game over
	private state: 'RUNNING' | 'GAME_OVER' = 'RUNNING';
	private mergeManager = new MergeManager();

	constructor(private canvas: HTMLCanvasElement) {
		this.engine = Engine.create({ gravity: { x: 0, y: PHYSICS.gravityY, scale: 0.001 } });
		this.world = this.engine.world;
		this.renderer = new CanvasRenderer(canvas);
		this.input = new Input(canvas, (px) => this.renderer.canvasPxToWorldX(px), this.renderer);
		this.audio = new AudioManager();
		try { this.best = Number(localStorage.getItem('best-score') || '0') || 0; } catch {}
	}

	async init() {
		await this.renderer.loadImages(); // preload images
		this.resetWorldBounds(); // reset physics/world
		this.wireEvents();
		this.rollNext();
		this.updateHUD();
		// state is already RUNNING (not GAME_OVER) by default
	}

	private resetWorldBounds() {
		Composite.clear(this.world, false, true);
		this.bodies = [];
		this.rebuildWorldBounds();
	}

	private rebuildWorldBounds() {
		const W = WORLD.width, H = WORLD.height, T = WORLD.wallThickness;
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
				// land sound when fruit hits ground or wall
				if (((a as any).plugin?.tierIndex != null) || ((b as any).plugin?.tierIndex != null)) this.audio.play('land');
			}
		});
	}


	private createFruit(tierIndex: number, x: number, y: number, vx: number = 0, vy: number = 0): FruitBody {
		const cfg = TIER_CONFIG[tierIndex];
		const r = getFruitRadius(tierIndex);
		const body = Bodies.circle(x, y, r, {
			restitution: PHYSICS.restitution,
			friction: PHYSICS.friction,
			frictionAir: 0.002,
			mass: cfg.mass,
		}) as FruitBody;
		(body as any).plugin = { tierIndex };
		(body as any).fruit = { 
			tier: tierIndex, 
			radius: r, 
			lastMergeAt: null 
		};
		Body.setVelocity(body, { x: vx, y: vy });
		World.add(this.world, body);
		this.bodies.push(body);
		return body;
	}

	private removeFruitBody(body: FruitBody) {
		World.remove(this.world, body);
		this.bodies = this.bodies.filter(b => b !== body);
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
		const radius = getFruitRadius(tier);
		const leftWall = radius + 4;
		const rightWall = WORLD.width - radius - 4;
		const clampedX = Math.max(leftWall, Math.min(rightWall, this.dropperX));
		this.createFruit(tier, clampedX, WORLD.spawnY);
		this.hasDroppedFruit = true; // mark that we've dropped at least one fruit
		this.rollNext();
	}

	private updateGameOver(dt: number) {
		// Guard: don't check game over until at least one fruit has been dropped
		if (!this.hasDroppedFruit) return;
		
		let anyOver = false;
		for (const b of this.bodies) {
			// Check if fruit's TOP edge (position.y - radius) crosses above the game over line
			const fruitTop = b.position.y - getFruitRadius(b.plugin.tierIndex);
			if (fruitTop <= WORLD.gameOverLineY) { 
				anyOver = true; 
				break; 
			}
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
		this.state = 'GAME_OVER';
		this.audio.play('gameover');
		this.updateOverlayVisibility();
	}

	private updateOverlayVisibility() {
		const dialog = document.getElementById('dialog')!;
		if (this.state === 'GAME_OVER') {
			dialog.classList.remove('hidden');
		} else {
			dialog.classList.add('hidden');
		}
	}

	restart() {
		this.gameOver = false; 
		this.overTimer = 0; 
		this.score = 0; 
		this.comboCount = 0; 
		this.lastMergeTime = 0;
		this.hasDroppedFruit = false; // reset the guard
		this.state = 'RUNNING'; // set state to RUNNING
		this.resetWorldBounds(); 
		this.rollNext(); 
		this.updateHUD();
		this.updateOverlayVisibility(); // hide overlay
	}

	setPaused(p: boolean) { this.paused = p; }
	setMuted(m: boolean) { this.audio.setMuted(m); }
	getMuted(): boolean { return this.audio.isMuted; }
	resizeCanvas() { 
		this.renderer.resizeCanvas(); 
		this.rebuildWorldBounds(); // Rebuild physics bounds on resize
	}

	async start() {
		await this.init();
		
		// Debounced resize function
		let resizeTimeout: number;
		const resize = () => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => this.renderer.resizeCanvas(), 100);
		};
		
		// Call resizeCanvas before starting the loop
		this.renderer.resizeCanvas();
		
		window.addEventListener('resize', resize);
		window.addEventListener('orientationchange', resize);
		// fixed timestep loop at 60Hz
		let acc = 0; let last = performance.now();
		const step = 1000/60;
		const tick = () => {
			const now = performance.now(); let dt = now - last; last = now;
			acc += dt; if (acc > 1000) acc = 1000; // spiral of death cap
			const touchX = this.input.getTouchWorldX();
			if (touchX != null) this.dropperX = Math.max(getFruitRadius(0) + 4, Math.min(WORLD.width - getFruitRadius(0) - 4, touchX));
			else {
				const speed = 420; // px/s
				const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
				this.dropperX = Math.max(getFruitRadius(0) + 4, Math.min(WORLD.width - getFruitRadius(0) - 4, this.dropperX + dir * (dt/1000) * speed));
			}
			if (this.input.consumeDrop()) this.dropFruit();
			if (!this.paused && !this.gameOver) {
				while (acc >= step) { 
					Engine.update(this.engine, step); 
					acc -= step; 
					
					// Process immediate merges after physics update
					this.mergeManager.collectCandidates(this.bodies, this.world, this.engine);
					this.mergeManager.process(this.world, this.bodies, 
						(tier, x, y, vx, vy) => {
							const newFruit = this.createFruit(tier, x, y, vx, vy);
							// Add visual effect and audio
							this.effects.push({ x, y, t: 0, duration: 300 });
							this.audio.play('pop');
							// Update scoring and combo
							const now = performance.now();
							if (now - this.lastMergeTime <= SCORING.comboWindowMs) this.comboCount++; else this.comboCount = 1;
							this.lastMergeTime = now;
							const gained = (SCORING.mergeBase * tier) * this.comboCount;
							this.score += Math.floor(gained);
							if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('best-score', String(this.best)); } catch {} }
							this.updateHUD();
							return newFruit;
						}, 
						(body) => this.removeFruitBody(body)
					);
				}
				this.updateGameOver(dt);
			}
			// update effects
			this.effects.forEach(e => e.t += dt);
			this.effects = this.effects.filter(e => e.t < e.duration);
			// render
			this.renderer.clear();
			const renderables: RenderableBody[] = this.bodies.map(b => ({ id: b.id, x: b.position.x, y: b.position.y, r: getFruitRadius(b.plugin.tierIndex), angle: b.angle, tierIndex: b.plugin.tierIndex }));
			this.renderer.drawWorldBounds();
			this.renderer.drawGameOverLine();
			this.renderer.drawBodies(renderables);
			this.renderer.drawDropper(this.dropperX, this.nextTierIndex);
			this.renderer.drawEffects(this.effects);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}
}


