import Matter, { Engine, World, Bodies, Body, Composite, Events, Detector } from 'matter-js';
import { TIER_CONFIG, WORLD, PHYSICS, SCORING, VIEW, getFruitRadius } from './config';
import { CanvasRenderer, RenderableBody } from './renderer';
import { Input } from './input';
import { AudioManager } from './audio';

type FruitBody = Body & { 
	plugin: { tierIndex: number; merging?: boolean };
	fruit: { tier: number; radius: number; lastMergeAt: number | null };
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
	private mergeCandidates: Set<string> = new Set(); // Track merge candidates
	
	// Merge system constants
	private readonly MERGE_COOLDOWN = 80; // ms
	private readonly VELOCITY_THRESHOLD = 5; // max relative velocity for merging
	private readonly OVERLAP_TOLERANCE = 0.15; // 15% of smallest radius

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
				if ((a as any).plugin?.tierIndex != null && (b as any).plugin?.tierIndex != null) {
					this.detectMergeCandidate(a, b);
				} else {
					// land sound when fruit hits ground or wall
					if (((a as any).plugin?.tierIndex != null) || ((b as any).plugin?.tierIndex != null)) this.audio.play('land');
				}
			}
		});
		
		Events.on(this.engine, 'collisionActive', (ev) => {
			for (const pair of ev.pairs) {
				const a = pair.bodyA as FruitBody; const b = pair.bodyB as FruitBody;
				if ((a as any).plugin?.tierIndex != null && (b as any).plugin?.tierIndex != null) {
					this.detectMergeCandidate(a, b);
				}
			}
		});
	}
	
	private getMergeKey(a: FruitBody, b: FruitBody): string {
		return a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
	}
	
	private detectMergeCandidate(a: FruitBody, b: FruitBody) {
		if (!a.fruit || !b.fruit) return;
		if (a.fruit.tier !== b.fruit.tier) return;
		if (a.plugin.merging || b.plugin.merging) return;
		
		// Check cooldown
		const now = performance.now();
		if (now - (a.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) return;
		if (now - (b.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) return;
		
		// Precise overlap detection
		const rMin = Math.min(a.fruit.radius, b.fruit.radius);
		const mergeEps = rMin * this.OVERLAP_TOLERANCE;
		const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
		const relV = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
		
		if (dist <= (a.fruit.radius + b.fruit.radius - mergeEps) && relV < this.VELOCITY_THRESHOLD) {
			this.mergeCandidates.add(this.getMergeKey(a, b));
		}
	}
	
	private checkProximityForMerges() {
		// Scan for nearby fruits that might not trigger collision events
		for (const fruit of this.bodies) {
			if (!fruit.fruit || fruit.plugin.merging) continue;
			
			// Check cooldown
			const now = performance.now();
			if (now - (fruit.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
			
			// Scan nearby fruits
			for (const otherFruit of this.bodies) {
				if (fruit === otherFruit || !otherFruit.fruit || otherFruit.plugin.merging) continue;
				if (fruit.fruit.tier !== otherFruit.fruit.tier) continue;
				
				// Check cooldown for other fruit
				if (now - (otherFruit.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
				
				// Check distance and overlap
				const rMin = Math.min(fruit.fruit.radius, otherFruit.fruit.radius);
				const mergeEps = rMin * this.OVERLAP_TOLERANCE;
				const dist = Math.hypot(fruit.position.x - otherFruit.position.x, fruit.position.y - otherFruit.position.y);
				const relV = Math.hypot(fruit.velocity.x - otherFruit.velocity.x, fruit.velocity.y - otherFruit.velocity.y);
				
				// Extended scan radius for proximity detection
				const scanRadius = Math.max(fruit.fruit.radius, otherFruit.fruit.radius) + 20;
				if (dist <= scanRadius && dist <= (fruit.fruit.radius + otherFruit.fruit.radius - mergeEps) && relV < this.VELOCITY_THRESHOLD) {
					this.mergeCandidates.add(this.getMergeKey(fruit, otherFruit));
				}
			}
		}
	}

	private processMerges() {
		if (!this.mergeCandidates.size) return;
		
		const now = performance.now();
		const mergedThisPass = new Set<number>();
		
		// Process all merge candidates
		for (const key of this.mergeCandidates) {
			const [idA, idB] = key.split('-').map(Number);
			
			// Find bodies by ID
			const a = this.bodies.find(b => b.id === idA);
			const b = this.bodies.find(b => b.id === idB);
			
			if (!a || !b || !a.fruit || !b.fruit) continue;
			if (a.fruit.tier !== b.fruit.tier) continue;
			if (mergedThisPass.has(a.id) || mergedThisPass.has(b.id)) continue;
			if (a.plugin.merging || b.plugin.merging) continue;
			
			// Check cooldown again
			if (now - (a.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
			if (now - (b.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
			
			// Verify they're still close enough
			const rMin = Math.min(a.fruit.radius, b.fruit.radius);
			const mergeEps = rMin * this.OVERLAP_TOLERANCE;
			const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
			const relV = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
			
			if (dist > (a.fruit.radius + b.fruit.radius - mergeEps) || relV >= this.VELOCITY_THRESHOLD) continue;
			
			// Perform the merge
			this.performMerge(a, b, now);
			mergedThisPass.add(a.id);
			mergedThisPass.add(b.id);
		}
		
		this.mergeCandidates.clear();
	}

	private processChainMerges() {
		const now = performance.now();
		
		// Group fruits by tier
		const fruitsByTier = new Map<number, FruitBody[]>();
		for (const body of this.bodies) {
			if (!body.fruit) continue;
			const tier = body.fruit.tier;
			if (!fruitsByTier.has(tier)) {
				fruitsByTier.set(tier, []);
			}
			fruitsByTier.get(tier)!.push(body);
		}
		
		// Process each tier for potential chain merges
		for (const [tier, fruits] of fruitsByTier) {
			if (fruits.length < 2) continue;
			if (tier >= TIER_CONFIG.length - 1) continue;
			
			// Check all pairs of fruits in the same tier
			for (let i = 0; i < fruits.length; i++) {
				for (let j = i + 1; j < fruits.length; j++) {
					const a = fruits[i];
					const b = fruits[j];
					
					// Skip if already merging or on cooldown
					if (a.plugin.merging || b.plugin.merging) continue;
					if (now - (a.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
					if (now - (b.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
					
					// Check distance and overlap
					const rMin = Math.min(a.fruit.radius, b.fruit.radius);
					const mergeEps = rMin * this.OVERLAP_TOLERANCE;
					const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
					const relV = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
					
					if (dist > (a.fruit.radius + b.fruit.radius - mergeEps) || relV >= this.VELOCITY_THRESHOLD) continue;
					
					// Perform the chain merge
					this.performMerge(a, b, now);
					break; // Break inner loop to avoid processing the same fruit twice
				}
			}
		}
	}
	
	private performMerge(a: FruitBody, b: FruitBody, now: number) {
		if (!a.fruit || !b.fruit) return;
		if (a.fruit.tier !== b.fruit.tier) return;
		
		const tier = a.fruit.tier;
		if (tier >= TIER_CONFIG.length - 1) return;
		
		a.plugin.merging = b.plugin.merging = true;
		const posX = (a.position.x + b.position.x) / 2;
		const posY = (a.position.y + b.position.y) / 2;
		
		// Calculate average velocity for the merged fruit
		const vx = (a.velocity.x + b.velocity.x) / 2;
		const vy = (a.velocity.y + b.velocity.y) / 2;
		
		// remove both and spawn next tier
		World.remove(this.world, a);
		World.remove(this.world, b);
		this.bodies = this.bodies.filter(x => x !== a && x !== b);
		const newFruit = this.createFruit(tier + 1, posX, posY - 6);
		
		// Set velocity to average of merged fruits
		Body.setVelocity(newFruit, { x: vx, y: vy });
		
		// Mark the new fruit as just merged
		if (newFruit.fruit) {
			newFruit.fruit.lastMergeAt = now;
		}
		
		this.audio.play('pop');
		// visual effect
		this.effects.push({ x: posX, y: posY, t: 0, duration: 300 });
		// scoring and combo
		if (now - this.lastMergeTime <= SCORING.comboWindowMs) this.comboCount++; else this.comboCount = 1;
		this.lastMergeTime = now;
		const gained = (SCORING.mergeBase * (tier + 1)) * this.comboCount;
		this.score += Math.floor(gained);
		if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('best-score', String(this.best)); } catch {} }
		this.updateHUD();
		
		// Check for chain merges with the new fruit
		this.checkChainMerges(newFruit, now);
	}
	
	private checkChainMerges(newFruit: FruitBody, now: number) {
		if (!newFruit.fruit) return;
		
		// Look for other same-tier fruits nearby and merge
		for (const otherFruit of this.bodies) {
			if (newFruit === otherFruit || !otherFruit.fruit) continue;
			if (newFruit.fruit.tier !== otherFruit.fruit.tier) continue;
			if (otherFruit.plugin.merging) continue;
			
			// Check cooldown
			if (now - (otherFruit.fruit.lastMergeAt || 0) < this.MERGE_COOLDOWN) continue;
			
			// Check distance and overlap
			const rMin = Math.min(newFruit.fruit.radius, otherFruit.fruit.radius);
			const mergeEps = rMin * this.OVERLAP_TOLERANCE;
			const dist = Math.hypot(newFruit.position.x - otherFruit.position.x, newFruit.position.y - otherFruit.position.y);
			const relV = Math.hypot(newFruit.velocity.x - otherFruit.velocity.x, newFruit.velocity.y - otherFruit.velocity.y);
			
			if (dist <= (newFruit.fruit.radius + otherFruit.fruit.radius - mergeEps) && relV < this.VELOCITY_THRESHOLD) {
				// Perform chain merge immediately
				this.performMerge(newFruit, otherFruit, now);
				break; // Only merge with one fruit at a time to avoid conflicts
			}
		}
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
		(body as any).fruit = { tier: tierIndex, radius: r, lastMergeAt: null };
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
		this.mergeCandidates.clear(); // clear merge candidates
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
				while (acc >= step) { Engine.update(this.engine, step); acc -= step; }
				// Check for proximity merges when collision events might miss
				this.checkProximityForMerges();
				// Process merges immediately after physics updates
				this.processMerges();
				// Process chain merges for fruits that just merged
				this.processChainMerges();
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


