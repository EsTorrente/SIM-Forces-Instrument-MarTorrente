export function createLabPanel({ params, simulation, robotManager, camera }) {
  const slidersContainer = document.createElement('div');
  slidersContainer.style.cssText = `
    position: fixed; top: 20px; left: 20px; z-index: 100;
    color: #fff; background: rgba(10, 10, 15, 0.85); padding: 15px 20px;
    border-radius: 8px; font-family: monospace; font-size: 12px;
    display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(0,255,255,0.2);
    max-height: 90vh; overflow-y: auto; transition: opacity 0.3s ease;
  `;

  const instructions = document.createElement('div');
  instructions.innerHTML = `
    <strong style="color:#0ff; font-size:14px">CONTROLS</strong><br/>
    [1-4] Forces | [5] P.Size | [6-9, 0] Formations<br/>
    [W] Dance Toggle | [Arrows] Chaos & Color<br/>
    [Z/X/Y] Auto-Cam | <strong style="color:#ff0">[H] Hide UI | [F] Fullscreen</strong>
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

  createSlider('Robot Scale', '0.1', '2.0', '0.1', '0.5', (v) => { 
    params.robotScaleFactor = v; 
    robotManager.robots.forEach(r => r.scale.setScalar(params.robotScaleFactor)); 
  });
  
  const repSlider = createSlider('Repulsion Force', '0', '1500', '10', '350', (v) => { params.repulsionForce = v; });
  createSlider('Particle Size', '0.01', '0.5', '0.01', '0.05', (v) => { params.particleSizeVal = v; });
  createSlider('Bounds X', '20', '300', '10', '20', (v) => { params.simBounds.x = v; robotManager.setFormation(params.currentFormation); });
  createSlider('Bounds Y', '20', '300', '10', '20', (v) => { params.simBounds.y = v; });
  createSlider('Bounds Z', '20', '300', '10', '20', (v) => { params.simBounds.z = v; robotManager.setFormation(params.currentFormation); });

  document.body.appendChild(slidersContainer);

  addEventListener('mousemove', (event) => {
    const mouseY = 1.0 - (event.clientY / innerHeight);
    params.repulsionForce = mouseY * 1500.0; 
    if(repSlider) {
      repSlider.value = params.repulsionForce;
      repSlider.previousElementSibling.querySelector('span').innerText = params.repulsionForce.toFixed(0);
    }
  });
  
  addEventListener('wheel', (event) => {
    if (params.autoRotateAxis) {
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
    if (event.code === 'Digit1') params.forceMode = 1.0;
    if (event.code === 'Digit2') params.forceMode = 2.0;
    if (event.code === 'Digit3') params.forceMode = 3.0;
    if (event.code === 'Digit4') params.forceMode = 4.0;
    if (event.code === 'Digit5') params.particleSizeVal = params.particleSizeVal > 0.1 ? 0.05 : 0.21;
    if (event.code === 'KeyZ') params.autoRotateAxis = params.autoRotateAxis === 'z' ? null : 'z';
    if (event.code === 'KeyX') params.autoRotateAxis = params.autoRotateAxis === 'x' ? null : 'x';
    if (event.code === 'KeyY') params.autoRotateAxis = params.autoRotateAxis === 'y' ? null : 'y';
    if (event.code === 'KeyC') params.autoRotateSpeed *= 1.5;
    if (event.code === 'KeyV') params.autoRotateSpeed *= 0.66; 

    if (event.code === 'ArrowUp') params.keys.up = true;
    if (event.code === 'ArrowRight') params.keys.right = true;
    if (event.code === 'ArrowLeft') params.keys.left = true;
    if (event.code === 'ArrowDown') params.targetColorMode = params.targetColorMode === 0.0 ? 1.0 : 0.0;

    if (event.code === 'Digit6') robotManager.setFormation('line');
    if (event.code === 'Digit7') robotManager.setFormation('row');
    if (event.code === 'Digit8') robotManager.setFormation('grid');
    if (event.code === 'Digit9') robotManager.setFormation('triangle');
    if (event.code === 'Digit0') robotManager.setFormation('classic-grid');

    if (event.code === 'KeyW') robotManager.toggleDance();

    if (event.code === 'KeyH') {
      params.uiVisible = !params.uiVisible;
      slidersContainer.style.opacity = params.uiVisible ? '1' : '0';
      slidersContainer.style.pointerEvents = params.uiVisible ? 'auto' : 'none';
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
    if (event.code === 'ArrowUp') params.keys.up = false;
    if (event.code === 'ArrowRight') params.keys.right = false;
    if (event.code === 'ArrowLeft') params.keys.left = false;
  });
}