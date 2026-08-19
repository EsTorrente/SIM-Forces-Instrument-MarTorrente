import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

// 🤖 ROBOT: imports
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';

const PARTICLE_COUNT = 262144;
const ROBOT_COUNT = 50;

let robotModel;
let robotAnimations = [];
let robots = [];
let robotMixers = [];
let robotActions = [];

// Dynamic Modifiers
let spacingMultiplier = 2.7;
let robotScaleFactor = 0.5;
let baseRobotSpeed = 0.8;
let isDancing = false;
let repulsionForce = 350.0;
let particleSizeVal = 0.05;
let simBounds = new THREE.Vector3(20.0, 20.0, 20.0);

let currentFormation = 'line';
let robotTargets = [];
let robotDirections = [];

const robotDataArray = Array.from({ length: ROBOT_COUNT }, () => new THREE.Vector4());

// Interactive State
let forceMode = 4.0;
let targetColorMode = 0.0;
let colorMode = 0.0;
let vibrationLevel = 0.0;
let pulseFactor = 0.0;
let speedFactor = 1.0; 

// UI State
let uiVisible = true;

// Camera Auto-Rotation State
let autoRotateAxis = null; 
let autoRotateSpeed = 0.01;

const keys = { up: false, right: false, left: false };

async function main() {
  const mount = document.querySelector('#app');

  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere WebGPU para ejecutar compute shaders.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  scene.fog = new THREE.FogExp2(0x000000, 0.012);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 500);
  camera.position.set(0, 5, 35);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);

  await renderer.init();

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(0, 0, 0);

  const params = createParameters();

  const simulation = createSimulation({
    renderer,
    scene,
    params,
    count: PARTICLE_COUNT,
    robotDataArray 
  });

  // ============================================================
  // 💡 PARTICLE LIGHTS
  // ============================================================
  const LIGHT_COUNT = 8;
  const particleLights = [];
  
  const blueColors = [
    new THREE.Color(0x00ffff), new THREE.Color(0x0044ff), new THREE.Color(0x00aaff), new THREE.Color(0xffffff),
    new THREE.Color(0x0022cc), new THREE.Color(0x44ccff), new THREE.Color(0x0066ff), new THREE.Color(0x88ddff)
  ];
  
  const redColors = [
    new THREE.Color(0xff0000), new THREE.Color(0xdd0000), new THREE.Color(0xff1111), new THREE.Color(0xaa0000),
    new THREE.Color(0xff0000), new THREE.Color(0xcc0000), new THREE.Color(0xff2200), new THREE.Color(0x880000)
  ];

  for (let i = 0; i < LIGHT_COUNT; i++) {
    const light = new THREE.PointLight(blueColors[i], 5.0, 25.0); 
    light.position.set(0, 1, 0);
    scene.add(light);
    particleLights.push(light);
  }

  // ============================================================
  // 🤖 ROBOTS & OMINOUS LIGHTING
  // ============================================================
  const ambientLight = new THREE.HemisphereLight(0x112233, 0x000000, 0.3);
  scene.add(ambientLight);

  const ominousBottomLight = new THREE.DirectionalLight(0xff0000, 30.0);
  ominousBottomLight.position.set(0, -20, 0);
  ominousBottomLight.target.position.set(0, 0, 0);
  scene.add(ominousBottomLight);
  scene.add(ominousBottomLight.target);

  const robotLoader = new GLTFLoader();

  robotLoader.load(
    './models/RobotExpressive.glb',
    (gltf) => {
      robotModel = gltf.scene;
      robotAnimations = gltf.animations;
      createRobots();
    },
    undefined,
    (error) => console.error('❌ Could not load RobotExpressive.glb:', error)
  );

  function createRobots() {
    const walkingClip = THREE.AnimationClip.findByName(robotAnimations, 'Walking');
    const danceClip = THREE.AnimationClip.findByName(robotAnimations, 'Dance');

    if (!walkingClip) return;

    for (let i = 0; i < ROBOT_COUNT; i++) {
      const robot = SkeletonUtils.clone(robotModel);
      robot.scale.setScalar(robotScaleFactor);
      scene.add(robot);

      const mixer = new THREE.AnimationMixer(robot);
      const walkAction = mixer.clipAction(walkingClip);
      const danceAction = danceClip ? mixer.clipAction(danceClip) : null;
      
      walkAction.play();
      const timeScale = 0.8 + Math.random() * 0.4;
      walkAction.timeScale = timeScale;
      if (danceAction) danceAction.timeScale = timeScale;

      robots.push(robot);
      robotMixers.push(mixer);
      robotActions.push({ walk: walkAction, dance: danceAction });
      
      robotTargets.push(new THREE.Vector3());
      robotDirections.push(1);
    }
    setFormation('line');
  }

  // 🚀 Epic Dynamic Formations utilizing the full Bounding Box
  function setFormation(formation) {
    currentFormation = formation;
    
    // Reset defaults for all
    for (let i = 0; i < robots.length; i++) {
      robots[i].visible = true;
      robotTargets[i].set(0, 0, 0);
      robotDirections[i] = 1; // 1: Positive Z, -1: Negative Z, 2: Circular, 3/-3: X-Axis
    }

    if (formation === 'line') {
      const maxRank = Math.ceil(ROBOT_COUNT / 2);
      const spreadX = (simBounds.x * 0.45) / maxRank;
      const spreadZ = (simBounds.z * 0.45) / maxRank;
      
      for (let i = 0; i < ROBOT_COUNT; i++) {
        if (i === 0) {
          robotTargets[i].set(0, 0, simBounds.z * 0.4);
        } else {
          const side = i % 2 === 0 ? 1 : -1;
          const rank = Math.floor((i + 1) / 2);
          robotTargets[i].set(side * rank * spreadX, 0, simBounds.z * 0.4 - rank * spreadZ);
        }
      }
    }
    else if (formation === 'row') {
      const cols = 10;
      const rows = 5;
      const spacingX = (simBounds.x * 0.8) / cols;
      const spacingZ = (simBounds.z * 0.8) / rows;
      
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * spacingX;
        const z = (row - (rows - 1) / 2) * spacingZ;
        robotTargets[i].set(x, 0, z);
      }
    }
    else if (formation === 'grid') {
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const isInner = i < 15;
        const count = isInner ? 15 : 35;
        const radius = isInner ? simBounds.x * 0.2 : simBounds.x * 0.4;
        const angle = (i % count) / count * Math.PI * 2;
        robotTargets[i].set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        robotDirections[i] = 2; // Circular
      }
    }
    else if (formation === 'triangle') {
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const leg = i % 4; 
        const rank = Math.floor(i / 4) + 1;
        const maxRanks = Math.ceil(ROBOT_COUNT / 4);
        const dist = (rank / maxRanks) * (simBounds.x * 0.45);
        const angle = leg * (Math.PI / 2) + Math.PI / 4;
        robotTargets[i].set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      }
    }
    else if (formation === 'classic-grid') {
      // 🚶‍♂️ Floating Stacked Grid (Mapped to Key 0)
      const cols = 10;
      const ROBOT_SPACING = 2.0;
      const ROW_SPACING = 2.0;

      for (let i = 0; i < ROBOT_COUNT; i++) {
        const row = Math.floor(i / cols);
        const column = i % cols;
        const x = (column - 4.5) * ROBOT_SPACING * spacingMultiplier;
        const y = (row - 2) * ROW_SPACING * spacingMultiplier;
        robotTargets[i].set(x, y, 0); // Stacked on Y, aligned on Z=0
        
        // 3 means walking Right (+X), -3 means walking Left (-X)
        robotDirections[i] = row % 2 === 0 ? -3 : 3; 
      }
    }

    for (let i = 0; i < robots.length; i++) {
      robots[i].position.copy(robotTargets[i]);
    }
  }

  function changeFormation(formation) {
    setFormation(formation);
  }

  function updateRobotMovement(delta) {
    const limitX = simBounds.x * 0.5;
    const limitZ = simBounds.z * 0.5;

    for (let i = 0; i < robots.length; i++) {
      const robot = robots[i];
      robotDataArray[i].set(robot.position.x, robot.position.y, robot.position.z, robot.visible ? 1 : 0);
      
      if (!robot.visible) continue;
      
      const dir = robotDirections[i];

      if (dir === 2) {
        // Circular continuous marching
        const angleSpeed = baseRobotSpeed * delta * 0.2;
        const x = robot.position.x;
        const z = robot.position.z;
        robot.position.x = x * Math.cos(angleSpeed) - z * Math.sin(angleSpeed);
        robot.position.z = x * Math.sin(angleSpeed) + z * Math.cos(angleSpeed);
        
        robot.rotation.y = Math.atan2(robot.position.x, robot.position.z) + Math.PI / 2;
      } else if (Math.abs(dir) === 3) {
        // X-Axis Left/Right Marching (for the 0 key stack)
        const sign = dir === 3 ? 1 : -1;
        robot.position.x += baseRobotSpeed * delta * sign;
        
        // Face the correct horizontal direction
        robot.rotation.y = sign === 1 ? Math.PI / 2 : -Math.PI / 2;

        if (robot.position.x > limitX) robot.position.x = -limitX;
        if (robot.position.x < -limitX) robot.position.x = limitX;
      } else {
        // Standard linear marching with bounds wrap (Z-Axis)
        robot.position.z += baseRobotSpeed * delta * dir;
        
        // Flip the robot 180 degrees if they are walking backwards (-1)
        robot.rotation.y = dir === 1 ? 0 : Math.PI;

        if (robot.position.z > limitZ) robot.position.z = -limitZ;
        if (robot.position.z < -limitZ) robot.position.z = limitZ;
      }
    }
  }

  // ============================================================
  // 🎛️ UI: SLIDERS & INFO
  // ============================================================
  const slidersContainer = document.createElement('div');
  slidersContainer.style.cssText = `
    position: fixed; top: 20px; left: 20px; z-index: 100;
    color: #fff; background: rgba(10, 10, 15, 0.85); padding: 15px 20px;
    border-radius: 8px; font-family: monospace; font-size: 12px;
    display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(0,255,255,0.2);
    max-height: 90vh; overflow-y: auto; transition: opacity 0.3s ease;
  `;

  // Instructions
  const instructions = document.createElement('div');
  instructions.innerHTML = `
    <strong style="color:#0ff; font-size:14px">CONTROLS</strong><br/>
    [1-4] Forces | [5] P.Size | [6-9, 0] Formations<br/>
    [W] Dance Toggle | [Arrows] Chaos & Color<br/>
    <strong style="color:#ff0">[H] Hide UI | [F] Fullscreen</strong>
  `;
  instructions.style.marginBottom = '10px';
  instructions.style.lineHeight = '1.4';
  slidersContainer.appendChild(instructions);

  function createSlider(labelTxt, min, max, step, initial, onChange) {
    const container = document.createElement('div');
    container.style.display = 'flex'; container.style.flexDirection = 'column';
    const label = document.createElement('label');
    label.innerHTML = `${labelTxt}: <span style="color:#0ff">${initial}</span>`;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = initial;
    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      label.querySelector('span').innerText = val.toFixed(step.includes('.') ? 2 : 0);
      onChange(val);
    };
    container.append(label, slider);
    slidersContainer.appendChild(container);
    return slider;
  }

  createSlider('Robot Scale', '0.1', '2.0', '0.1', '0.5', (v) => { robotScaleFactor = v; robots.forEach(r => r.scale.setScalar(robotScaleFactor)); });
  const repSlider = createSlider('Repulsion Force', '0', '1500', '10', '350', (v) => { repulsionForce = v; });
  createSlider('Particle Size', '0.01', '0.5', '0.01', '0.05', (v) => { particleSizeVal = v; });
  
  createSlider('Bounds X', '20', '300', '10', '20', (v) => { simBounds.x = v; setFormation(currentFormation); });
  createSlider('Bounds Y', '20', '300', '10', '20', (v) => { simBounds.y = v; });
  createSlider('Bounds Z', '20', '300', '10', '20', (v) => { simBounds.z = v; setFormation(currentFormation); });

  document.body.appendChild(slidersContainer);

  // KEYBOARD AND MOUSE INTERACTIONS -------------------------------------
  addEventListener('mousemove', (event) => {
    const mouseY = 1.0 - (event.clientY / innerHeight);
    repulsionForce = mouseY * 1500.0; 
    
    if(repSlider) {
      repSlider.value = repulsionForce;
      repSlider.previousElementSibling.querySelector('span').innerText = repulsionForce.toFixed(0);
    }
  });
  
  // 🔍 Zoom override for auto-rotate
  addEventListener('wheel', (event) => {
    if (autoRotateAxis) {
      const zoomSpeed = 0.001;
      const factor = 1.0 + (event.deltaY * zoomSpeed);
      const newRadius = camera.position.length() * factor;
      if (newRadius > 2.0 && newRadius < 200.0) {
        camera.position.multiplyScalar(factor);
      }
    }
  }, { passive: true });

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyR') simulation.reset();

    // 🌟 Simulation Modes
    if (event.code === 'Digit1') forceMode = 1.0;
    if (event.code === 'Digit2') forceMode = 2.0;
    if (event.code === 'Digit3') forceMode = 3.0;
    if (event.code === 'Digit4') forceMode = 4.0;
    
    // 💥 Toggle Particle Size
    if (event.code === 'Digit5') {
      particleSizeVal = particleSizeVal > 0.1 ? 0.05 : 0.21;
    }

    // 🎥 Camera Rotations
    if (event.code === 'KeyZ') autoRotateAxis = autoRotateAxis === 'z' ? null : 'z';
    if (event.code === 'KeyX') autoRotateAxis = autoRotateAxis === 'x' ? null : 'x';
    if (event.code === 'KeyY') autoRotateAxis = autoRotateAxis === 'y' ? null : 'y';
    if (event.code === 'KeyC') autoRotateSpeed *= 1.5;
    if (event.code === 'KeyV') autoRotateSpeed *= 0.66; 

    // 🌈 Interactions
    if (event.code === 'ArrowUp') keys.up = true;
    if (event.code === 'ArrowRight') keys.right = true;
    if (event.code === 'ArrowLeft') keys.left = true;
    if (event.code === 'ArrowDown') targetColorMode = targetColorMode === 0.0 ? 1.0 : 0.0;

    // 🤖 Robot formations
    if (event.code === 'Digit6') changeFormation('line');
    if (event.code === 'Digit7') changeFormation('row');
    if (event.code === 'Digit8') changeFormation('grid');
    if (event.code === 'Digit9') changeFormation('triangle');
    if (event.code === 'Digit0') changeFormation('classic-grid'); // Fixed!
    
    // 🕺 Dance Toggle
    if (event.code === 'KeyW') {
      isDancing = !isDancing;
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const actions = robotActions[i];
        if (!actions || !actions.dance) continue;

        if (isDancing) {
          actions.dance.reset().play();
          actions.walk.crossFadeTo(actions.dance, 0.2, true);
        } else {
          actions.walk.reset().play();
          actions.dance.crossFadeTo(actions.walk, 0.2, true);
        }
      }
    }

    // 📺 UI Display Toggles
    if (event.code === 'KeyH') {
      uiVisible = !uiVisible;
      slidersContainer.style.opacity = uiVisible ? '1' : '0';
      slidersContainer.style.pointerEvents = uiVisible ? 'auto' : 'none';
    }
    
    if (event.code === 'KeyF') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => console.log(err));
      } else {
        document.exitFullscreen().catch((err) => console.log(err));
      }
    }
  });

  addEventListener('keyup', (event) => {
    if (event.code === 'ArrowUp') keys.up = false;
    if (event.code === 'ArrowRight') keys.right = false;
    if (event.code === 'ArrowLeft') keys.left = false;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  simulation.reset();

  // ============================================================
  // FRAME LOOP
  // ============================================================
  let previousTime = performance.now();

  renderer.setAnimationLoop(() => {
    const currentTime = performance.now();
    const time = currentTime * 0.001;
    const delta = (currentTime - previousTime) / 1000;
    previousTime = currentTime;

    // 🎹 "PLAYABLE" TIME & CHAOS LOGIC
    if (keys.right) {
      speedFactor += (4.0 - speedFactor) * 0.05; 
      vibrationLevel += delta * 15.0; 
    } else if (keys.left) {
      speedFactor += (0.02 - speedFactor) * 0.1;
      vibrationLevel += (0.0 - vibrationLevel) * 0.2;
    } else {
      speedFactor += (1.0 - speedFactor) * 0.05;
      vibrationLevel += (0.0 - vibrationLevel) * 0.2;
    }

    pulseFactor += ((keys.up ? 1.0 : 0.0) - pulseFactor) * 0.1;
    colorMode += (targetColorMode - colorMode) * 0.05;

    // 🎥 Dynamic Cinematic Camera Zoom
    const baseFov = 50;
    const maxZoomFovDrop = 15; 
    camera.fov = baseFov - (pulseFactor * maxZoomFovDrop);
    camera.updateProjectionMatrix();

    // 🔥 Reactive Factory/Fire Background (Multi-Stage Color Interpolation)
    const bgIntensity = Math.min(pulseFactor * 0.4 + (vibrationLevel / 20.0), 1.0);
    const bgColor = new THREE.Color('#000000');
    
    const fireMid = new THREE.Color('#ffaa00'); // Hot Yellow/Orange transition
    const fireHot = new THREE.Color('#ff0000'); // Deep Crimson Red
    
    if (bgIntensity < 0.15) {
      // 0.0 -> 0.15 transitions Black to Yellow (Fast spike)
      const t = bgIntensity / 0.15; 
      bgColor.lerpColors(new THREE.Color('#000000'), fireMid, t);
    } else {
      // 0.15 -> 1.0 transitions Yellow to Red (Long deep red hold)
      const t = (bgIntensity - 0.15) / 0.85; 
      bgColor.lerpColors(fireMid, fireHot, t);
    }

    scene.background = bgColor;
    scene.fog.color = bgColor;

    const dynamicRobotScale = robotScaleFactor * (1.0 + pulseFactor * 0.2); 

    for (let i = 0; i < particleLights.length; i++) {
      const light = particleLights[i];
      const phase = (i / particleLights.length) * Math.PI * 2;
      const radius = 10.0 + Math.sin(time * 0.4 + phase) * 5.0;

      light.position.x = Math.cos(time * 0.35 + phase) * radius;
      light.position.y = 5.0 + Math.sin(time * 0.7 + phase) * 5.0; 
      light.position.z = Math.sin(time * 0.35 + phase) * radius;
      
      light.color.lerpColors(blueColors[i], redColors[i], colorMode);
    }

    // Sync GPU uniform updates
    simulation.uTime.value = time;
    simulation.uForceMode.value = forceMode;
    simulation.uVibrationLevel.value = vibrationLevel;
    simulation.uSpeedFactor.value = speedFactor;
    simulation.uPulseFactor.value = pulseFactor;
    simulation.uColorMode.value = colorMode;
    simulation.uRepulsion.value = repulsionForce;
    simulation.uParticleSize.value = particleSizeVal;
    simulation.uBounds.value.copy(simBounds);
    
    simulation.stepSimulation();
    
    updateRobotMovement(delta * speedFactor);

    for (let i = 0; i < robots.length; i++) {
      if (robots[i].visible) {
        robots[i].scale.setScalar(dynamicRobotScale);
      }
    }

    for (const mixer of robotMixers) {
      mixer.update(delta * speedFactor);
    }
    
    // 🎥 Camera Automation Management
    if (autoRotateAxis) {
      orbit.enabled = false; 
      const angle = autoRotateSpeed * speedFactor; 
      
      const axisMap = {
        'x': new THREE.Vector3(1, 0, 0),
        'y': new THREE.Vector3(0, 1, 0),
        'z': new THREE.Vector3(0, 0, 1)
      };
      
      camera.position.applyAxisAngle(axisMap[autoRotateAxis], angle);
      camera.lookAt(0, 0, 0);
    } else {
      orbit.enabled = true; 
      orbit.update();
    }
    
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
});