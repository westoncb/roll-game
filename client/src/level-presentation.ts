import { gameAssets } from "./assets";
import { parallel } from "./engine/effects/effect";
import { EffectScheduler } from "./engine/effects/scheduler";
import type { TickEvents } from "./engine/events";
import { ParticleSystem } from "./engine/particles/system";
import type { Coordinates, GameEvents, PlayerId } from "./game-events";
import { HealthPopup } from "./health-popup";
import type { Level } from "./level";
import { playerConfig } from "./player/config";
import { maxPunchStrength } from "./player/grapple-motion";
import { PunchBurst } from "./punch-burst";
import { RobotHud } from "./robot-hud";
import { lerp } from "./utils/math";

const impactBorderFadeSeconds = 0.48;

export class LevelPresentation {
  private readonly scheduler = new EffectScheduler();
  readonly particles = new ParticleSystem(this.scheduler);
  private readonly effects = new Set<HealthPopup | PunchBurst>();
  private readonly readouts = new Map<PlayerId, RobotHud>();
  private previousImpactBorder = 0;
  private impactBorder = 0;
  private impactBorderHoldUntil = 0;

  constructor(private readonly level: Level) {
    for (const player of [level.player, level.rival]) {
      if (player)
        this.readouts.set(
          player.id,
          new RobotHud(player, player === level.player, level.size, (popup) =>
            this.effects.add(popup)
          )
        );
    }
  }

  update({ start, end, events }: TickEvents<GameEvents>) {
    this.previousImpactBorder = this.impactBorder;
    if (end > this.impactBorderHoldUntil) {
      const fadeTime = end - Math.max(start, this.impactBorderHoldUntil);
      this.impactBorder = Math.max(
        0,
        this.impactBorder - fadeTime / impactBorderFadeSeconds
      );
    }
    for (const effect of this.effects) {
      if (effect.expiresAt <= start) this.effects.delete(effect);
    }

    for (const { kind, data, time } of events) {
      switch (kind) {
        case "punched":
          this.showPunch(data, time);
          break;
        case "healthChanged":
          this.readouts.get(data.player)!.healthChanged(data, time);
          break;
        case "defeated":
          this.showDefeat(data, time);
          break;
        case "scored":
          this.readouts.get(data.player)!.scored(data.before, time);
          break;
        case "footPlanted": {
          const { position, normal, speed, landingSpeed } = data;
          if (landingSpeed === null && speed === 0) break;
          const { jump, movement } = playerConfig;
          const strength =
            landingSpeed === null
              ? movement.maxStepDustStrength * Math.min(1, speed / movement.topSpeed)
              : Math.min(1, landingSpeed / jump.fullSpeed);
          this.scheduler.play(
            this.particlesAt("landing-dust", position, {
              angle: Math.atan2(normal[1], normal[0]),
              strength
            }),
            time
          );
          break;
        }
        case "ashCrumbled":
          this.scheduler.play(
            this.particlesAt("fungal-ash", data.position, { strength: data.strength }),
            time
          );
          break;
      }
    }
    for (const hud of this.readouts.values())
      hud.flushFungalDamage(end, !!this.level.result);
    this.scheduler.advanceTo(end);
  }

  private particlesAt(
    asset: string,
    position: Coordinates,
    { strength, angle }: { strength?: number; angle?: number } = {}
  ) {
    return this.particles.effect(
      gameAssets.particles.get(asset),
      { kind: "world", position, angle },
      { strength }
    );
  }

  private showPunch(
    { player, position, direction, strength: impactStrength }: GameEvents["punched"],
    time: number
  ) {
    const victim = this.level.getPlayer(player);
    const hitYou = victim === this.level.player;
    victim.screen.showImpact();
    const strength = Math.min(1, impactStrength);
    const relativeImpulse = Math.min(1, impactStrength / maxPunchStrength);
    if (hitYou && relativeImpulse >= this.impactBorder) {
      this.impactBorder = relativeImpulse;
      this.impactBorderHoldUntil = time + lerp(0.04, 0.1, relativeImpulse);
    }
    this.effects.add(
      new PunchBurst(
        position,
        direction,
        relativeImpulse,
        time,
        victim.visual,
        victim.body.radius
      )
    );
    const gain = strength ** 0.75 * (hitYou ? 1 : 0.36);
    const camera = this.level.camera;
    this.scheduler.play(
      parallel(
        camera.shakeEffect({
          amplitude: 12 * gain,
          duration: lerp(0.12, 0.18, strength),
          frequency: 4.2,
          direction,
          crossAxis: 0
        }),
        camera.shakeEffect({
          amplitude: 8.5 * gain,
          duration: (hitYou ? 0.48 : 0.26) * lerp(0.7, 1, strength),
          frequency: 10.5,
          crossAxis: 0.8,
          envelope: (t) => (1 - t * t) ** 2
        }),
        this.particlesAt("punch-dust", position, {
          angle: Math.atan2(-direction[1], -direction[0]),
          strength
        })
      ),
      time
    );
  }

  private showDefeat({ player, position, velocity }: GameEvents["defeated"], time: number) {
    const victim = this.level.getPlayer(player);
    for (const effect of this.effects) {
      if (effect instanceof PunchBurst && effect.target === victim.visual)
        effect.fadeOnKnockout(time);
    }
    this.scheduler.play(
      parallel(
        this.level.camera.shakeEffect({
          amplitude: victim === this.level.player ? 6 : 1.4,
          duration: 0.26,
          frequency: 8
        }),
        this.particlesAt("impact-sparks", position, {
          angle: Math.atan2(velocity[1], velocity[0])
        })
      ),
      time
    );
  }

  impactBorderOpacity(alpha: number) {
    return 0.76 * lerp(this.previousImpactBorder, this.impactBorder, alpha) ** 1.45;
  }

  drawOverlays(
    ctx: CanvasRenderingContext2D,
    alpha: number,
    time: number,
    reducedMotion: boolean
  ) {
    for (const effect of this.effects) effect.visual.render(ctx, alpha, time);
    const { player, rival, camera } = this.level;
    const largestDuelScore = rival ? Math.max(player.score, rival.score) : undefined;
    for (const hud of this.readouts.values())
      hud.draw(ctx, time, camera.zoom, reducedMotion, largestDuelScore);
  }
}
