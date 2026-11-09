import { raceConfig as c, type CarState, type Obstacle, type RaceCommand, type RaceSnapshot, type RaceStatus } from './config';

/** Pure simulation: commands and snapshots form a future network transport boundary. Units: metres, seconds. */
export class RaceModel {
  status: RaceStatus = 'ready';
  cars: CarState[] = [];
  obstacles: Obstacle[] = [];
  boost = 0; slow = 0; elapsed = 0;
  constructor(private readonly playerOnly = false) { this.reset(); }
  reset() {
    this.status = 'ready'; this.boost = this.slow = this.elapsed = 0;
    this.cars = Array.from({ length: this.playerOnly ? 1 : c.carCount }, (_, i) => ({ id: `car-${i}`, name: i === 0 ? 'Bé tài xế' : ['Thỏ Tím', 'Mèo Hồng', 'Gấu Xanh', 'Cáo Lam'][(i - 1) % 4], color: c.colors[i % c.colors.length], lane: i % c.lanes, distance: i === 0 ? 0 : 12 + i * 17, speed: 0 }));
    this.cars[0].lane = 1;
    this.obstacles = Array.from({ length: Math.floor((c.trackLength - 200) / c.obstacleSpacing) }, (_, i) => ({ id: i, lane: (i * 2 + 1) % c.lanes, distance: 200 + i * c.obstacleSpacing, hit: false }));
  }
  command(command: RaceCommand) {
    switch (command.type) {
      case 'restart': this.reset(); break;
      case 'start': if (this.status === 'ready' || this.status === 'paused') this.status = 'running'; break;
      case 'pause': if (this.status === 'running') this.status = 'paused'; break;
      case 'clearBoost': if (this.status === 'running') this.boost = 0; break;
      case 'boost': if (this.status === 'running') this.boost = c.boostDuration; break;
      case 'lane': if (this.status === 'running') this.cars[0].lane = Math.max(0, Math.min(c.lanes - 1, this.cars[0].lane + command.direction)); break;
    }
  }
  update(dt: number) {
    if (this.status !== 'running') return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.elapsed += dt; this.boost = Math.max(0, this.boost - dt); this.slow = Math.max(0, this.slow - dt);
    this.cars.forEach((car, i) => {
      if (car.finishTime !== undefined) return;
      car.speed = i === 0 ? (this.slow > 0 ? c.slowSpeed : this.boost > 0 ? c.boostSpeed : c.baseSpeed) : c.baseSpeed + Math.sin(this.elapsed * .45 + i * 2) * 2 + i * .15;
      const previous = car.distance;
      car.distance = Math.min(c.trackLength, car.distance + car.speed * dt);
      if (i === 0) for (const o of this.obstacles) {
        if (!o.hit && o.lane === car.lane && previous <= o.distance && car.distance >= o.distance) { o.hit = true; this.slow = c.slowDuration; this.boost = 0; }
      }
      if (car.distance >= c.trackLength) { car.finishTime = this.elapsed; car.speed = 0; }
    });
    if (this.cars[0].finishTime !== undefined) this.status = 'finished';
  }
  snapshot(): RaceSnapshot {
    const cars = this.cars.map(car => ({ ...car })).sort((a,b) => b.distance - a.distance || (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity));
    return { status: this.status, cars, rank: cars.findIndex(car => car.id === 'car-0') + 1, speed: Math.round(this.cars[0].speed * 3.6), distance: this.cars[0].distance, boost: this.boost, slow: this.slow, elapsed: this.elapsed };
  }
}
