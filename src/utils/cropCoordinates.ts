export interface DisplayMetrics {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function computeDisplayMetrics(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): DisplayMetrics {
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const offsetX = (containerW - imageW * scale) / 2;
  const offsetY = (containerH - imageH * scale) / 2;
  return { scale, offsetX, offsetY };
}

export function screenToCropRect(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  metrics: DisplayMetrics,
  imageW: number,
  imageH: number
): { originX: number; originY: number; width: number; height: number } {
  const { scale, offsetX, offsetY } = metrics;
  const originX = Math.max(0, (sx1 - offsetX) / scale);
  const originY = Math.max(0, (sy1 - offsetY) / scale);
  const x2px = Math.min(imageW, (sx2 - offsetX) / scale);
  const y2px = Math.min(imageH, (sy2 - offsetY) / scale);
  return {
    originX,
    originY,
    width: x2px - originX,
    height: y2px - originY,
  };
}
