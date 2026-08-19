import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  hash,
  instanceIndex,
  instancedArray,
  max,
  mix,
  mod,
  step,
  uint,
  uv,
  vec3,
  vec4,
  sin,
  cos,
  uniform,
  uniformArray
} from 'three/tsl';

export function createSimulation({ renderer, scene, params, count = 131072, robotDataArray }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');
  
  const uTime = uniform(0.0);
  const uRobotData = uniformArray(robotDataArray);
  const uForceMode = uniform(4.0);
  const uVibrationLevel = uniform(0.0);
  const uPulseFactor = uniform(0.0);
  const uColorMode = uniform(0.0);
  const uRepulsion = uniform(350.0); 
  
  const uBounds = uniform(new THREE.Vector3(20.0, 20.0, 20.0));
  const uParticleSize = uniform(0.05);
  const uSpeedFactor = uniform(1.0);

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const p = positionBuffer.element(i);
    const v = velocityBuffer.element(i);

    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    const r4 = hash(i.add(uint(53)));
    const r5 = hash(i.add(uint(71)));
    const r6 = hash(i.add(uint(89)));

    p.assign(vec3(r1, r2, r3).sub(0.5).mul(uBounds));
    v.assign(vec3(r4, r5, r6).sub(0.5).mul(params.initialSpeed));
  })().compute(count).setName('Initialize Particles');

  const updateParticles = Fn(() => {
    const p = positionBuffer.element(instanceIndex);
    const v = velocityBuffer.element(instanceIndex);

    const dt = params.dt.mul(params.timeScale).mul(uSpeedFactor);
    const force = vec3(0.0).toVar();

    // 1. BASE FORCE MODES
    If(uForceMode.equal(1.0), () => { 
      force.addAssign(vec3(
        sin(p.y.mul(1.5)).mul(40.0),
        cos(p.z.mul(1.5)).mul(40.0),
        sin(p.x.mul(1.5)).mul(40.0)
      ));
    }).ElseIf(uForceMode.equal(2.0), () => { 
      const r = p.length();
      const portal = sin(r.mul(0.8).sub(uTime.mul(6.0))).mul(60.0);
      force.addAssign(p.normalize().mul(portal));
    }).ElseIf(uForceMode.equal(3.0), () => { 
      force.addAssign(vec3(
        sin(p.z.mul(0.5).add(uTime)).mul(50.0),
        sin(p.x.mul(0.5).sub(uTime)).mul(50.0),
        cos(p.y.mul(0.5).add(uTime)).mul(50.0)
      ));
    }).Else(() => { 
      const spin = vec3(p.z.mul(-1.0), p.y.mul(0.0), p.x).mul(1.5); 
      const radSq = p.x.mul(p.x).add(p.z.mul(p.z));
      const wave = sin(radSq.mul(0.01).sub(uTime.mul(5.0))).mul(25.0);
      const expand = vec3(p.x, p.y.mul(0.8), p.z).normalize().mul(wave);
      force.addAssign(spin.add(expand));
    });

    // 2. ROBOT POOLING FORCE (Attract far, repel close)
    for (let i = 0; i < 50; i++) {
      const rData = uRobotData.element(i);
      const rPos = rData.xyz;
      const rActive = rData.w; 

      const toRobot = rPos.sub(p);
      const dist = max(toRobot.length(), 0.1);
      const dir = toRobot.div(dist);

      const attractStr = 15.0; 
      const repelStr = uRepulsion; 

      const magnitude = rActive.mul(
        dist.pow(-1.0).mul(attractStr).sub( dist.pow(-2.0).mul(repelStr) )
      );
      force.addAssign(dir.mul(magnitude));
    }

    // 3. MICRO-TURBULENCE
    const microNoise = vec3(
      sin(p.x.mul(5.0).add(p.y.mul(3.0))),
      sin(p.y.mul(5.0).add(p.z.mul(3.0))),
      sin(p.z.mul(5.0).add(p.x.mul(3.0)))
    ).mul(10.0);
    force.addAssign(microNoise);

    // 4. VIBRATION
    const jitter = vec3(
      sin(uTime.mul(150.0).add(p.x.mul(50.0))),
      cos(uTime.mul(160.0).add(p.y.mul(50.0))),
      sin(uTime.mul(170.0).add(p.z.mul(50.0)))
    ).mul(uVibrationLevel).mul(30.0);
    force.addAssign(jitter);

    // 5. STABILITY DAMPING
    force.addAssign(v.mul(-1.5)); 
    v.addAssign(force.mul(dt));

    const speed = v.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      v.assign(v.normalize().mul(params.maxSpeed));
    });

    p.addAssign(v.mul(dt));

    const half = uBounds.mul(0.5);
    p.assign(mod(p.add(half), uBounds).sub(half));
  })().compute(count).setName('Update Particles');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = uParticleSize.mul( uPulseFactor.mul(1.5).add(1.0) );

  material.colorNode = Fn(() => {
    const speed = velocityBuffer.toAttribute().length();
    const t = speed.div(params.maxSpeed).clamp(0.0, 1.0);
    
    const slowColor = mix(color('#0011ff'), color('#ff0000'), uColorMode); 
    const fastColor = mix(color('#00ffff'), color('#ff1100'), uColorMode); 
    
    const baseColor = mix(slowColor, fastColor, t);
    const brightnessBoost = uPulseFactor.mul(1.5);
    
    return vec4(baseColor.xyz.add(vec3(1.0, 1.0, 1.0).mul(brightnessBoost)), 1.0);
  })();

  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function reset() {
    renderer.compute(initParticles);
  }

  function stepSimulation() {
    renderer.compute(updateParticles);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    scene.remove(mesh);
  }

  return {
    count,
    uTime,
    uForceMode,
    uVibrationLevel,
    uPulseFactor,
    uColorMode,
    uRepulsion, 
    uBounds, 
    uParticleSize, 
    uSpeedFactor, 
    positionBuffer,
    velocityBuffer,
    reset,
    stepSimulation,
    dispose
  };
}