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

const ROBOTS_PER_ROW = 10;
const ROW_SPACING = 1.2;
const ROBOT_SPACING = 0.8;

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
// Default to 20x20x20
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

// Camera Auto-Rotation State
let autoRotateAxis = null; // 'x', 'y', 'z', or null
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
  // 🤖 ROBOTS
  // ============================================================
  const ambientLight = new THREE.HemisphereLight(0x223344, 0x000000, 1.5);
  scene.add(ambientLight);

  const robotLoader = new GLTFLoader();

  robotLoader.load(
    '/models/RobotExpressive.glb',
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

  function setFormation(formation) {
    currentFormation = formation;
    
    for (let i = 0; i < robots.length; i++) {
      robots[i].visible = true;
      robotTargets[i].set(0, 0, 0);
      robotDirections[i] = 1;
    }

    if (formation === 'line') {
      for (let i = 0; i < 5; i++) {
        robotTargets[i].set(0, 0, (i - 2) * ROBOT_SPACING * spacingMultiplier);
      }
      for (let i = 5; i < ROBOT_COUNT; i++) robots[i].visible = false;
    }
    else if (formation === 'row') {
      for (let i = 0; i < 5; i++) {
        robotTargets[i].set((i - 2) * ROBOT_SPACING * spacingMultiplier, 0, 0);
      }
      for (let i = 5; i < ROBOT_COUNT; i++) robots[i].visible = false;
    }
    else if (formation === 'grid') {
      const cols = 10;
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const row = Math.floor(i / cols);
        const column = i % cols;
        const x = (column - 4.5) * ROBOT_SPACING * spacingMultiplier;
        const y = (row - 2) * ROW_SPACING * spacingMultiplier; 
        robotTargets[i].set(x, y, 0);
        robotDirections[i] = row % 2 === 0 ? 1 : -1;
      }
    }
    else if (formation === 'triangle') {
      let index = 0;
      const rows = 9;
      for (let row = 0; row < rows; row++) {
        const robotsInRow = row + 1;
        const z = (row - (rows - 1) / 2) * ROW_SPACING * spacingMultiplier;
        for (let column = 0; column < robotsInRow; column++) {
          if (index >= ROBOT_COUNT) break;
          const x = (column - (robotsInRow - 1) / 2) * ROBOT_SPACING * spacingMultiplier;
          robotTargets[index].set(x, 0, z);
          index++;
        }
      }
      for (let i = index; i < ROBOT_COUNT; i++) robots[i].visible = false;
    }

    for (let i = 0; i < robots.length; i++) {
      robots[i].position.copy(robotTargets[i]);
      if (currentFormation === 'grid') {
        robots[i].rotation.y = robotDirections[i] === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        robots[i].rotation.y = 0; 
      }
    }
  }

  function changeFormation(formation) {
    robotScaleFactor = 0.5;
    spacingMultiplier = 2.7;
    setFormation(formation);
  }

  function updateRobotMovement(delta) {
    const limitX = simBounds.x * 0.5;
    const limitZ = simBounds.z * 0.5;

    for (let i = 0; i < robots.length; i++) {
      const robot = robots[i];
      robotDataArray[i].set(robot.position.x, robot.position.y, robot.position.z, robot.visible ? 1 : 0);
      
      if (!robot.visible) continue;
      
      const direction = robotDirections[i];
      if (currentFormation === 'grid') {
        robot.position.x += direction * baseRobotSpeed * delta;
      } else {
        robot.position.z += baseRobotSpeed * delta;
      }

      if (robot.position.x > limitX) robot.position.x = -limitX;
      if (robot.position.x < -limitX) robot.position.x = limitX;
      if (robot.position.z > limitZ) robot.position.z = -limitZ;
      if (robot.position.z < -limitZ) robot.position.z = limitZ;
    }
  }

  // ============================================================
  // 🎛️ UI: SLIDERS
  // ============================================================
  const slidersContainer = document.createElement('div');
  slidersContainer.style.cssText = `
    position: fixed; top: 80px; left: 20px; z-index: 100;
    color: #fff; background: rgba(10, 10, 15, 0.85); padding: 15px 20px;
    border-radius: 8px; font-family: monospace; font-size: 12px;
    display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(0,255,255,0.2);
    max-height: 80vh; overflow-y: auto;
  `;

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

  createSlider('Robot Spacing', '0.2', '3.0', '0.1', '2.7', (v) => { spacingMultiplier = v; setFormation(currentFormation); });
  createSlider('Robot Scale', '0.1', '2.0', '0.1', '0.5', (v) => { robotScaleFactor = v; robots.forEach(r => r.scale.setScalar(robotScaleFactor)); });
  const repSlider = createSlider('Repulsion Force', '0', '1500', '10', '350', (v) => { repulsionForce = v; });
  
  createSlider('Particle Size', '0.01', '0.5', '0.01', '0.05', (v) => { particleSizeVal = v; });
  
  // Update Bounds UI Defaults to 20
  createSlider('Bounds X', '20', '300', '10', '20', (v) => { simBounds.x = v; });
  createSlider('Bounds Y', '20', '300', '10', '20', (v) => { simBounds.y = v; });
  createSlider('Bounds Z', '20', '300', '10', '20', (v) => { simBounds.z = v; });

  document.body.appendChild(slidersContainer);

  // KEYBOARD AND MOUSE INTERACTIONS -------------------------------------
  addEventListener('mousemove', (event) => {
    // Map mouse Y (top of screen is 1.0, bottom is 0.0) to repulsion force
    const mouseY = 1.0 - (event.clientY / innerHeight);
    repulsionForce = mouseY * 1500.0; 
    
    // Update the slider UI visually
    repSlider.value = repulsionForce;
    repSlider.previousElementSibling.querySelector('span').innerText = repulsionForce.toFixed(0);
  });

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyR') simulation.reset();

    // 🌟 Simulation Modes (1-4, 5 removed from forces)
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
    if (event.code === 'KeyV') autoRotateSpeed *= 0.66; // slow down

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

    // 🔥 Reactive Factory/Fire Background
    // Calculate intensity based on interaction modifiers
    const bgIntensity = Math.min(pulseFactor * 0.4 + (vibrationLevel / 20.0), 1.0);
    const fireBase = new THREE.Color('#220500'); // Deep smoldering factory red
    const fireHot = new THREE.Color('#ff3300');  // Fast intense flare
    
    const bgColor = new THREE.Color('#000000');
    bgColor.lerp(fireBase, bgIntensity);
    bgColor.lerp(fireHot, bgIntensity * bgIntensity); // Square it for snappy hot flashes
    
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
      orbit.enabled = false; // Disable orbit control overrides while auto-rotating
      const angle = autoRotateSpeed * speedFactor; // Scale rotation with the beat drop speed
      
      const axisMap = {
        'x': new THREE.Vector3(1, 0, 0),
        'y': new THREE.Vector3(0, 1, 0),
        'z': new THREE.Vector3(0, 0, 1)
      };
      
      camera.position.applyAxisAngle(axisMap[autoRotateAxis], angle);
      camera.lookAt(0, 0, 0);
    } else {
      orbit.enabled = true; // Re-enable seamlessly 
      orbit.update();
    }
    
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
});