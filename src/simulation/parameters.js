import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

export const PARTICLE_COUNT = 262144;
export const ROBOT_COUNT = 50;

export function createParameters() {
  return {
    // TSL Uniforms
    dt: uniform(1 / 60),
    timeScale: uniform(1.0),
    initialSpeed: uniform(0.35),
    maxSpeed: uniform(5.0),

    // Dynamic Modifiers & Robot State
    spacingMultiplier: 2.7,
    robotScaleFactor: 0.5,
    baseRobotSpeed: 0.8,
    isDancing: false,
    repulsionForce: 350.0,
    particleSizeVal: 0.05,
    simBounds: new THREE.Vector3(20.0, 20.0, 20.0),
    currentFormation: 'line',

    // Interactive State
    forceMode: 4.0,
    targetColorMode: 0.0,
    colorMode: 0.0,
    vibrationLevel: 0.0,
    pulseFactor: 0.0,
    speedFactor: 1.0, 

    // UI & Camera State
    uiVisible: true,
    autoRotateAxis: null, 
    autoRotateSpeed: 0.01,
    keys: { up: false, right: false, left: false }
  };
}