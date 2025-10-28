export type Tier = {
	key: string;
	radius: number; // pixels at base logical size; renderer scales by DPR
	mass: number;
	img: string; // path under public/
	label: string;
};

export const TIER_CONFIG: Tier[] = [
	{ key:'tier0', radius:16, mass:1.0, img:'Asset/icon_01.png', label:'Lv1' },
	{ key:'tier1', radius:22, mass:1.2, img:'Asset/icon_02.png', label:'Lv2' },
	{ key:'tier2', radius:30, mass:1.4, img:'Asset/icon_03.png', label:'Lv3' },
	{ key:'tier3', radius:40, mass:1.8, img:'Asset/icon_04.png', label:'Lv4' },
	{ key:'tier4', radius:52, mass:2.2, img:'Asset/icon_05.png', label:'Lv5' },
	{ key:'tier5', radius:64, mass:3.0, img:'Asset/icon_06.png', label:'Lv6' },
	{ key:'tier6', radius:78, mass:3.6, img:'Asset/icon_07.png', label:'Lv7' },
	{ key:'tier7', radius:92, mass:4.5, img:'Asset/icon_08.png', label:'Lv8' },
	{ key:'tier8', radius:108, mass:5.2, img:'Asset/icon_09.png', label:'Lv9' },
	{ key:'tier9', radius:124, mass:6.0, img:'Asset/icon_10.png', label:'Lv10' },
	{ key:'tier10', radius:140, mass:7.0, img:'Asset/icon_11.png', label:'MAX' },
];

export const PHYSICS = {
	gravityY: 0.8,
	friction: 0.3,
	restitution: 0.1,
};

export const WORLD = {
	logicalWidth: 900, // 9:16 aspect ratio world units
	logicalHeight: 1600,
	wallThickness: 40,
	spawnY: 80,
	maxHeightY: 110, // game over threshold line
};

export const SCORING = {
	mergeBase: 10,
	comboWindowMs: 1200,
};


