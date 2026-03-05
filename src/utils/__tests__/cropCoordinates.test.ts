import { computeDisplayMetrics, screenToCropRect } from '../cropCoordinates';

describe('computeDisplayMetrics', () => {
  it('scales to fit width when image is wider than container', () => {
    // 200x100 image in a 100x100 container → scale by width (0.5)
    const m = computeDisplayMetrics(100, 100, 200, 100);
    expect(m.scale).toBeCloseTo(0.5);
    expect(m.offsetX).toBeCloseTo(0);
    expect(m.offsetY).toBeCloseTo(25); // (100 - 100*0.5) / 2
  });

  it('scales to fit height when image is taller than container', () => {
    // 100x200 image in a 100x100 container → scale by height (0.5)
    const m = computeDisplayMetrics(100, 100, 100, 200);
    expect(m.scale).toBeCloseTo(0.5);
    expect(m.offsetX).toBeCloseTo(25); // (100 - 100*0.5) / 2
    expect(m.offsetY).toBeCloseTo(0);
  });

  it('fills container exactly when aspect ratios match', () => {
    const m = computeDisplayMetrics(200, 100, 200, 100);
    expect(m.scale).toBeCloseTo(1);
    expect(m.offsetX).toBeCloseTo(0);
    expect(m.offsetY).toBeCloseTo(0);
  });
});

describe('screenToCropRect', () => {
  it('maps screen rect to image pixels', () => {
    // 200x200 image displayed at scale=0.5 in 100x100 container (no letterbox)
    const metrics = { scale: 0.5, offsetX: 0, offsetY: 0 };
    const rect = screenToCropRect(10, 10, 90, 90, metrics, 200, 200);
    expect(rect.originX).toBeCloseTo(20);
    expect(rect.originY).toBeCloseTo(20);
    expect(rect.width).toBeCloseTo(160);
    expect(rect.height).toBeCloseTo(160);
  });

  it('clamps negative originX/Y to 0', () => {
    const metrics = { scale: 1, offsetX: 10, offsetY: 10 };
    const rect = screenToCropRect(5, 5, 50, 50, metrics, 100, 100);
    expect(rect.originX).toBe(0);
    expect(rect.originY).toBe(0);
  });

  it('clamps width/height to image bounds', () => {
    const metrics = { scale: 1, offsetX: 0, offsetY: 0 };
    const rect = screenToCropRect(0, 0, 150, 150, metrics, 100, 100);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(100);
  });
});
