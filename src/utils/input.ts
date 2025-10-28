export function clientToWorldFromEvent(ev: MouseEvent|TouchEvent, canvas: HTMLCanvasElement, scale: number){
  const r = canvas.getBoundingClientRect();
  const cx = ('touches' in ev && ev.touches?.length) ? ev.touches[0].clientX : (ev as MouseEvent).clientX;
  const cy = ('touches' in ev && ev.touches?.length) ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
  const xCss = cx - r.left, yCss = cy - r.top;
  return { x: xCss/scale, y: yCss/scale };
}
