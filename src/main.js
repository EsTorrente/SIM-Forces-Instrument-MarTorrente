import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import { pass, uv, sin, cos, vec3, vec4, uniform, float, Fn } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { PARTICLE_COUNT, createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { RobotManager } from './robotManager.js';
import { createLabPanel } from './ui/labPanel.js';

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

  // Core Systems
  const params = createParameters();
  const robotManager = new RobotManager(scene, params);
  robotManager.load();

  const simulation = createSimulation({
    renderer,
    scene,
    params,
    count: PARTICLE_COUNT,
    robotDataArray: robotManager.robotDataArray 
  });

  // Attach UI
  createLabPanel({ params, simulation, robotManager, camera });

  // ============================================================
  // 💡 LIGHTING
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

  const ambientLight = new THREE.HemisphereLight(0x112233, 0x000000, 0.3);
  scene.add(ambientLight);

  const ominousBottomLight = new THREE.DirectionalLight(0xff0000, 30.0);
  ominousBottomLight.position.set(0, -20, 0);
  ominousBottomLight.target.position.set(0, 0, 0);
  scene.add(ominousBottomLight);
  scene.add(ominousBottomLight.target);

  // ============================================================
  // 🌫️ VOLUMETRIC GROUND FOG PLANE
  // ============================================================
  const fogGeo = new THREE.PlaneGeometry(160, 160, 64, 64);
  fogGeo.rotateX(-Math.PI / 2);

  const uFogTime = uniform(0.0);
  const uFogPulse = uniform(0.0);

  const fogMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  fogMat.colorNode = Fn(() => {
    const st = uv().sub(0.5).mul(2.0);
    const dist = st.length();
    const radialFade = float(1.0).sub(dist).clamp(0.0, 1.0).pow(2.0);

    const noiseCoords = uv().mul(12.0);
    const wave1 = sin(noiseCoords.x.add(uFogTime.mul(0.6))).mul(cos(noiseCoords.y.sub(uFogTime.mul(0.4))));
    const wave2 = sin(noiseCoords.x.mul(1.8).sub(uFogTime)).mul(sin(noiseCoords.y.mul(2.2).add(uFogTime.mul(0.8))));
    const fogDensity = wave1.add(wave2).mul(0.25).add(0.5);

    const baseRed = vec3(0.85, 0.05, 0.02).mul(fogDensity);
    const glow = vec3(1.0, 0.25, 0.1).mul(uFogPulse.mul(1.2));

    const finalColor = baseRed.add(glow);
    const alpha = radialFade.mul(fogDensity).mul(0.55);

    return vec4(finalColor, alpha);
  })();

  const groundFog = new THREE.Mesh(fogGeo, fogMat);
  groundFog.position.y = -0.05;
  scene.add(groundFog);

  // ============================================================
  // 🌟 POST-PROCESSING: BLOOM & CRT SCANLINES
  // ============================================================
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);

  const uBloomStrength = uniform(1.0);
  const uVibrationUniform = uniform(0.0);

  const bloomPass = bloom(scenePass, uBloomStrength, 0.5, 0.1);

  const scanlineCrtPass = Fn(() => {
    const sceneColor = scenePass.add(bloomPass);
    const screenUV = uv();

    const scanlineIntensity = uVibrationUniform.mul(0.02).clamp(0.0, 0.4).add(0.2);
    const scanline = sin(screenUV.y.mul(innerHeight * 1.5))
      .mul(0.12)
      .mul(scanlineIntensity);

    const distFromCenter = screenUV.sub(0.5).length();
    const vignette = distFromCenter.mul(0.35).pow(2.0);

    return sceneColor.sub(scanline).sub(vignette);
  })();

  postProcessing.outputNode = scanlineCrtPass;

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

    if (params.keys.right) {
      params.speedFactor += (4.0 - params.speedFactor) * 0.05; 
      params.vibrationLevel += delta * 15.0; 
    } else if (params.keys.left) {
      params.speedFactor += (0.02 - params.speedFactor) * 0.1;
      params.vibrationLevel += (0.0 - params.vibrationLevel) * 0.2;
    } else {
      params.speedFactor += (1.0 - params.speedFactor) * 0.05;
      params.vibrationLevel += (0.0 - params.vibrationLevel) * 0.2;
    }

    params.pulseFactor += ((params.keys.up ? 1.0 : 0.0) - params.pulseFactor) * 0.1;
    params.colorMode += (params.targetColorMode - params.colorMode) * 0.05;

    uVibrationUniform.value = params.vibrationLevel;
    uFogTime.value = time;
    uFogPulse.value = params.pulseFactor;

    const baseFov = 50;
    const maxZoomFovDrop = 15; 
    camera.fov = baseFov - (params.pulseFactor * maxZoomFovDrop);
    camera.updateProjectionMatrix();

    const bgIntensity = Math.min(params.pulseFactor * 0.4 + (params.vibrationLevel / 20.0), 1.0);
    const bgColor = new THREE.Color('#000000');
    const fireMid = new THREE.Color('#ffaa00');
    const fireHot = new THREE.Color('#ff0000');
    
    if (bgIntensity < 0.15) {
      const t = bgIntensity / 0.15; 
      bgColor.lerpColors(new THREE.Color('#000000'), fireMid, t);
    } else {
      const t = (bgIntensity - 0.15) / 0.85; 
      bgColor.lerpColors(fireMid, fireHot, t);
    }

    scene.background = bgColor;
    scene.fog.color = bgColor;

    for (let i = 0; i < particleLights.length; i++) {
      const light = particleLights[i];
      const phase = (i / particleLights.length) * Math.PI * 2;
      const radius = 10.0 + Math.sin(time * 0.4 + phase) * 5.0;

      light.position.x = Math.cos(time * 0.35 + phase) * radius;
      light.position.y = 5.0 + Math.sin(time * 0.7 + phase) * 5.0; 
      light.position.z = Math.sin(time * 0.35 + phase) * radius;
      
      light.color.lerpColors(blueColors[i], redColors[i], params.colorMode);
    }

    simulation.uTime.value = time;
    simulation.uForceMode.value = params.forceMode;
    simulation.uVibrationLevel.value = params.vibrationLevel;
    simulation.uSpeedFactor.value = params.speedFactor;
    simulation.uPulseFactor.value = params.pulseFactor;
    simulation.uColorMode.value = params.colorMode;
    simulation.uRepulsion.value = params.repulsionForce;
    simulation.uParticleSize.value = params.particleSizeVal;
    simulation.uBounds.value.copy(params.simBounds);
    
    simulation.stepSimulation();
    robotManager.update(delta * params.speedFactor);
    
    if (params.autoRotateAxis) {
      orbit.enabled = false; 
      const angle = params.autoRotateSpeed * params.speedFactor; 
      
      const axisMap = {
        'x': new THREE.Vector3(1, 0, 0),
        'y': new THREE.Vector3(0, 1, 0),
        'z': new THREE.Vector3(0, 0, 1)
      };
      
      camera.position.applyAxisAngle(axisMap[params.autoRotateAxis], angle);
      camera.lookAt(0, 0, 0);
    } else {
      orbit.enabled = true; 
      orbit.update();
    }

    // 🎥 CAMERA SHAKE
    const shakeOffset = new THREE.Vector3();
    if (params.isDancing || params.vibrationLevel > 0.05 || params.pulseFactor > 0.05) {
      const shakeIntensity = (params.isDancing ? 0.12 : 0.0) + params.vibrationLevel * 0.04 + params.pulseFactor * 0.15;
      shakeOffset.set(
        (Math.random() - 0.5) * shakeIntensity,
        (Math.random() - 0.5) * shakeIntensity,
        (Math.random() - 0.5) * shakeIntensity
      );
    }

    const savedCameraPos = camera.position.clone();
    camera.position.add(shakeOffset);

    postProcessing.render();
    camera.position.copy(savedCameraPos);
  });
}

main().catch((error) => console.error(error));