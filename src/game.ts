import Matter, { Engine, World, Bodies, Body, Composite, Events, Detector } from 'matter-js';
import { TIER_CONFIG, WORLD, PHYSICS, SCORING, VIEW, getFruitRadius } from './config';
import { CanvasRenderer, RenderableBody } from './renderer';
import { Input } from './input';
import { AudioManager } from './audio';

type FruitBody = Body & { 
	plugin: { tierIndex: number; merging?: boolean };
	fruit: {
		tier: number;
		radius: number;
		lastMergeAt: number;
	};
};

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
	
	// Merge system
	private mergeCandidates = new Set<string>();

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
		this.mergeCandidates.clear();
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
		Events.on(this.engine, 'collisionStart', this.onCollisionPairs);
		Events.on(this.engine, 'collisionActive', this.onCollisionPairs);
	}

	private onCollisionPairs = (ev: any) => {
		for (const pair of ev.pairs) {
			const a = pair.bodyA as FruitBody; 
			const b = pair.bodyB as FruitBody;
			
			if (a.fruit && b.fruit) {
				// Handle fruit-to-fruit collisions for merging
				if (a.fruit.tier === b.fruit.tier) {
					this.addMergeCandidate(a, b);
				}
			} else {
				// land sound when fruit hits ground or wall
				if (a.fruit || b.fruit) this.audio.play('land');
			}
		}
	}

	private root(b: Body): Body {
		return (b as any).parent || b;
	}

	private key(a: Body, b: Body): string {
		const A = a.id <= b.id ? a : b;
		const B = a.id <= b.id ? b : a;
		return `${A.id}-${B.id}`;
	}

	private addMergeCandidate(a: FruitBody, b: FruitBody) {
		const A = this.root(a) as FruitBody;
		const B = this.root(b) as FruitBody;
		
		if (!A.fruit || !B.fruit) return;
		if (A.fruit.tier !== B.fruit.tier) return;

		// distance & overlap in WORLD units
		const dx = A.position.x - B.position.x;
		const dy = A.position.y - B.position.y;
		const dist = Math.hypot(dx, dy);
		const rA = A.fruit.radius;
		const rB = B.fruit.radius;

		// small epsilon to be forgiving
		const eps = Math.min(rA, rB) * 0.15;
		if (dist <= (rA + rB - eps)) {
			this.mergeCandidates.add(this.key(A, B));
		}
	}

	private processMerges() {
		if (!this.mergeCandidates.size) return;

		// throttle double-merge on same body for a few ms
		const now = performance.now();
		const mergedThisPass = new Set<number>();

		// build unique pairs
		const pairs: [FruitBody, FruitBody][] = [];
		for (const k of this.mergeCandidates) {
			const [idA, idB] = k.split('-').map(Number);
			const A = Composite.get(this.engine.world, idA, 'body') as FruitBody;
			const B = Composite.get(this.engine.world, idB, 'body') as FruitBody;
			if (!A || !B || !A.fruit || !B.fruit) continue;
			if (A.fruit.tier !== B.fruit.tier) continue;
			if (mergedThisPass.has(A.id) || mergedThisPass.has(B.id)) continue;
			if (now - (A.fruit.lastMergeAt || 0) < 80) continue;
			if (now - (B.fruit.lastMergeAt || 0) < 80) continue;
			pairs.push([A, B]);
			mergedThisPass.add(A.id);
			mergedThisPass.add(B.id);
		}
		this.mergeCandidates.clear();

		if (!pairs.length) return;

		for (const [A, B] of pairs) {
			const t = A.fruit.tier;
			const newTier = t + 1;

			// new body at midpoint, average velocity
			const x = (A.position.x + B.position.x) / 2;
			const y = (A.position.y + B.position.y) / 2;
			const vx = (A.velocity.x + B.velocity.x) / 2;
			const vy = (A.velocity.y + B.velocity.y) / 2;

			// remove old, add new
			World.remove(this.world, A);
			World.remove(this.world, B);
			this.bodies = this.bodies.filter(x => x !== A && x !== B);
			const C = this.createFruit(newTier, x, y);
			Body.setVelocity(C, { x: vx, y: vy });
			if (C.fruit) C.fruit.lastMergeAt = performance.now();

			// scoring and combo
			const now = performance.now();
			if (now - this.lastMergeTime <= SCORING.comboWindowMs) this.comboCount++; else this.comboCount = 1;
			this.lastMergeTime = now;
			const gained = (SCORING.mergeBase * (t + 1)) * this.comboCount;
			this.score += Math.floor(gained);
			if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('best-score', String(this.best)); } catch {} }

			// visual effect
			this.effects.push({ x, y, t: 0, duration: 300 });
			this.audio.play('pop');
		}

		this.updateHUD();
	}

	private createFruit(tierIndex: number, x: number, y: number): FruitBody {
		const cfg = TIER_CONFIG[tierIndex];
		const r = getFruitRadius(tierIndex);
		const body = Bodies.circle(x, y, r, {
			restitution: PHYSICS.restitution,
			friction: PHYSICS.friction,
			frictionAir: 0.002,
			mass: cfg.mass,
		}) as FruitBody;
		(body as any).plugin = { tierIndex };
		body.fruit = {
			tier: tierIndex,
			radius: r,
			lastMergeAt: 0
		};
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
					this.processMerges(); // process merges after each physics step
					acc -= step; 
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


