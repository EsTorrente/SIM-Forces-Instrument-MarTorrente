import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ROBOT_COUNT } from './simulation/parameters.js';

export class RobotManager {
  constructor(scene, params) {
    this.scene = scene;
    this.params = params;
    this.robots = [];
    this.robotMixers = [];
    this.robotActions = [];
    this.robotTargets = [];
    this.robotDirections = [];
    this.robotDataArray = Array.from({ length: ROBOT_COUNT }, () => new THREE.Vector4());
  }

  load() {
    const robotLoader = new GLTFLoader();
    robotLoader.load(
      import.meta.env.BASE_URL + 'models/RobotExpressive.glb',
      (gltf) => this.createRobots(gltf.scene, gltf.animations),
      undefined,
      (error) => console.error('❌ Could not load RobotExpressive.glb:', error)
    );
  }

  createRobots(model, animations) {
    const walkingClip = THREE.AnimationClip.findByName(animations, 'Walking');
    const danceClip = THREE.AnimationClip.findByName(animations, 'Dance');

    if (!walkingClip) return;

    for (let i = 0; i < ROBOT_COUNT; i++) {
      const robot = SkeletonUtils.clone(model);
      robot.scale.setScalar(this.params.robotScaleFactor);
      this.scene.add(robot);

      const mixer = new THREE.AnimationMixer(robot);
      const walkAction = mixer.clipAction(walkingClip);
      const danceAction = danceClip ? mixer.clipAction(danceClip) : null;
      
      walkAction.play();
      const timeScale = 0.8 + Math.random() * 0.4;
      walkAction.timeScale = timeScale;
      if (danceAction) danceAction.timeScale = timeScale;

      this.robots.push(robot);
      this.robotMixers.push(mixer);
      this.robotActions.push({ walk: walkAction, dance: danceAction });
      
      this.robotTargets.push(new THREE.Vector3());
      this.robotDirections.push(1);
    }
    this.setFormation(this.params.currentFormation);
  }

  setFormation(formation) {
    this.params.currentFormation = formation;
    const { simBounds } = this.params;
    
    for (let i = 0; i < this.robots.length; i++) {
      this.robots[i].visible = true;
      this.robotTargets[i].set(0, 0, 0);
      this.robotDirections[i] = 1; 
    }

    if (formation === 'line') {
      const maxRank = Math.ceil(ROBOT_COUNT / 2);
      const spreadX = (simBounds.x * 0.45) / maxRank;
      const spreadZ = (simBounds.z * 0.45) / maxRank;
      
      for (let i = 0; i < ROBOT_COUNT; i++) {
        if (i === 0) {
          this.robotTargets[i].set(0, 0, simBounds.z * 0.4);
        } else {
          const side = i % 2 === 0 ? 1 : -1;
          const rank = Math.floor((i + 1) / 2);
          this.robotTargets[i].set(side * rank * spreadX, 0, simBounds.z * 0.4 - rank * spreadZ);
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
        this.robotTargets[i].set(x, 0, z);
      }
    }
    else if (formation === 'grid') {
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const isInner = i < 15;
        const count = isInner ? 15 : 35;
        const radius = isInner ? simBounds.x * 0.2 : simBounds.x * 0.4;
        const angle = (i % count) / count * Math.PI * 2;
        this.robotTargets[i].set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        this.robotDirections[i] = 2; 
      }
    }
    else if (formation === 'triangle') {
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const leg = i % 4; 
        const rank = Math.floor(i / 4) + 1;
        const maxRanks = Math.ceil(ROBOT_COUNT / 4);
        const dist = (rank / maxRanks) * (simBounds.x * 0.45);
        const angle = leg * (Math.PI / 2) + Math.PI / 4;
        this.robotTargets[i].set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      }
    }
    else if (formation === 'classic-grid') {
      const cols = 10;
      const ROBOT_SPACING = 2.0;
      const ROW_SPACING = 2.0;

      for (let i = 0; i < ROBOT_COUNT; i++) {
        const row = Math.floor(i / cols);
        const column = i % cols;
        const x = (column - 4.5) * ROBOT_SPACING * this.params.spacingMultiplier;
        const y = (row - 2) * ROW_SPACING * this.params.spacingMultiplier;
        this.robotTargets[i].set(x, y, 0); 
        this.robotDirections[i] = row % 2 === 0 ? -3 : 3; 
      }
    }

    for (let i = 0; i < this.robots.length; i++) {
      this.robots[i].position.copy(this.robotTargets[i]);
    }
  }

  toggleDance() {
    this.params.isDancing = !this.params.isDancing;
    for (let i = 0; i < ROBOT_COUNT; i++) {
      const actions = this.robotActions[i];
      if (!actions || !actions.dance) continue;

      if (this.params.isDancing) {
        actions.dance.reset().play();
        actions.walk.crossFadeTo(actions.dance, 0.2, true);
      } else {
        actions.walk.reset().play();
        actions.dance.crossFadeTo(actions.walk, 0.2, true);
      }
    }
  }

  update(delta) {
    const limitX = this.params.simBounds.x * 0.5;
    const limitZ = this.params.simBounds.z * 0.5;

    for (let i = 0; i < this.robots.length; i++) {
      const robot = this.robots[i];
      this.robotDataArray[i].set(robot.position.x, robot.position.y, robot.position.z, robot.visible ? 1 : 0);
      
      if (!robot.visible) continue;
      
      const dir = this.robotDirections[i];

      if (dir === 2) {
        const angleSpeed = this.params.baseRobotSpeed * delta * 0.2;
        const x = robot.position.x;
        const z = robot.position.z;
        robot.position.x = x * Math.cos(angleSpeed) - z * Math.sin(angleSpeed);
        robot.position.z = x * Math.sin(angleSpeed) + z * Math.cos(angleSpeed);
        robot.rotation.y = Math.atan2(robot.position.x, robot.position.z) + Math.PI / 2;
      } else if (Math.abs(dir) === 3) {
        const sign = dir === 3 ? 1 : -1;
        robot.position.x += this.params.baseRobotSpeed * delta * sign;
        robot.rotation.y = sign === 1 ? Math.PI / 2 : -Math.PI / 2;

        if (robot.position.x > limitX) robot.position.x = -limitX;
        if (robot.position.x < -limitX) robot.position.x = limitX;
      } else {
        robot.position.z += this.params.baseRobotSpeed * delta * dir;
        robot.rotation.y = dir === 1 ? 0 : Math.PI;

        if (robot.position.z > limitZ) robot.position.z = -limitZ;
        if (robot.position.z < -limitZ) robot.position.z = limitZ;
      }
    }

    const dynamicRobotScale = this.params.robotScaleFactor * (1.0 + this.params.pulseFactor * 0.2); 
    for (let i = 0; i < this.robots.length; i++) {
      if (this.robots[i].visible) {
        this.robots[i].scale.setScalar(dynamicRobotScale);
      }
    }

    for (const mixer of this.robotMixers) {
      mixer.update(delta);
    }
  }
}