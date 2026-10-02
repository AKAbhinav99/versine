/* The "how a reading is made" figure, in 3D.
 *
 * A clay figure seen from behind, built from rounded primitives (a sphere for
 * the head, capsules for the trunk, limbs and the shoulder girdle), lit like a
 * product shot: a soft key light that drifts slowly so the clearcoat glints
 * move, a cool rim light, an environment for reflections, and a contact
 * shadow on the floor. The scroll scrub (scenes.js) drives one progress value:
 * the parts pop in, the plumb line drops, the four landmarks land, and the
 * measuring lines draw themselves as tubes in space, all while the camera
 * swings round from three-quarters to dead behind. It must end square on: the
 * measurement is a straight-on reading, so the drawing finishes as one.
 *
 * Progressive: three.js is fetched only when this runs, from jsDelivr's single
 * file ESM build. If WebGL or the fetch fails, the SVG drawing under the canvas
 * stays, and that is a complete figure on its own. */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/+esm';

const SHOULDER_TILT_DEG = 4.2;   // matches the readout beside the figure
const HIP_TILT_DEG = 1.2;

const COLORS = {
  clay: '#DCE6EB',
  clayDeep: '#C3D3DC',
  scrub: '#1F6E8C',
  marker: '#D6402A',
  level: '#9AAEB9',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutBack = (x) => {
  const c1 = 1.9; const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/**
 * Mounts the figure into `host` (an element the canvas fills).
 * @param {number} timelineDuration the scrub timeline's length, in its own
 *   time units, so stage timings here can be written in the same units.
 * @returns {Promise<{setProgress(p:number):void, destroy():void}|null>}
 */
export async function mountFigure(host, timelineDuration) {
  let THREE;
  try {
    THREE = await import(/* @vite-ignore */ THREE_URL);
  } catch {
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;   // no WebGL: the SVG stays
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'how__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const scene = new THREE.Scene();

  /* A small studio, baked into an environment map, for reflections. Built
     here rather than loaded, so there is nothing else to fetch. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new THREE.Scene();
  studio.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: '#C8D3D9', side: THREE.BackSide })));
  const softbox = (w, h, pos, intensity) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(intensity), side: THREE.DoubleSide }));
    panel.position.copy(pos);
    panel.lookAt(0, 1, 0);
    studio.add(panel);
  };
  softbox(4, 3, new THREE.Vector3(-3, 4, 4), 6);
  softbox(3, 2, new THREE.Vector3(4, 2, 2), 3);
  softbox(6, 1, new THREE.Vector3(0, 5.5, -2), 2);
  const envMap = pmrem.fromScene(studio, 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.85;

  /* Lights: warm key from above left (it drifts), cool rim from behind right,
     and a sky/ground fill. */
  scene.add(new THREE.HemisphereLight('#F4F8FA', '#9FB3BE', 0.65));
  const key = new THREE.DirectionalLight('#FFF6EC', 3.2);
  key.position.set(-1.8, 5, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 7;
  key.shadow.camera.left = -3.5; key.shadow.camera.right = 3.5;
  key.shadow.camera.top = 3.5; key.shadow.camera.bottom = -3.5;
  key.shadow.camera.near = 1; key.shadow.camera.far = 12;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#CFE6F2', 2.2);
  rim.position.set(2.6, 2.4, -3);
  scene.add(rim);

  /* Floor: catches the shadow only, so the figure stands on the card. */
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ color: '#0E2230', opacity: 0.14 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ---------------------------------------------------------- the figure --- */

  const clay = new THREE.MeshPhysicalMaterial({
    color: COLORS.clay, roughness: 0.34, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.14, sheen: 0.4, sheenColor: new THREE.Color('#FFFFFF'),
  });
  const clayDeep = clay.clone();
  clayDeep.color = new THREE.Color(COLORS.clayDeep);

  const figure = new THREE.Group();
  scene.add(figure);
  const parts = [];   // { mesh, at } popped in at time `at`

  const capsule = (radius, length, material = clay) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 24), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const sphere = (radius, material = clay) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  /* Each part pops in by scaling about a pivot, so it grows from where it
     joins the body rather than from its own centre. */
  const addPart = (mesh, at, pivot = null) => {
    const holder = new THREE.Group();
    if (pivot) {
      holder.position.copy(pivot);
      mesh.position.sub(pivot);
    }
    holder.add(mesh);
    figure.add(holder);
    parts.push({ holder, at });
    return holder;
  };

  const tilt = (deg) => (deg * Math.PI) / 180;
  const shoulderY = 1.46;
  const hipY = 0.93;

  /* Legs. */
  for (const side of [-1, 1]) {
    const leg = capsule(0.074, 0.72, clayDeep);
    leg.position.set(side * 0.098, 0.45, 0);
    addPart(leg, 0.15, new THREE.Vector3(side * 0.098, hipY, 0));
  }
  /* Pelvis: a flattened sphere, tilted a little. */
  const pelvis = sphere(0.2);
  pelvis.scale.set(1, 0.62, 0.62);
  pelvis.position.set(0, hipY, 0);
  pelvis.rotation.z = tilt(HIP_TILT_DEG);
  addPart(pelvis, 0.3, new THREE.Vector3(0, hipY, 0));
  /* Trunk: a wide, shallow capsule. */
  const trunk = capsule(0.16, 0.34);
  trunk.scale.set(1.12, 1, 0.66);
  trunk.position.set(0, 1.2, 0);
  addPart(trunk, 0.42, new THREE.Vector3(0, hipY, 0));
  /* Shoulder girdle: a horizontal capsule, tilted by the reading's angle. */
  const girdle = new THREE.Group();
  girdle.position.set(0, shoulderY, 0);
  girdle.rotation.z = tilt(SHOULDER_TILT_DEG);
  const yoke = capsule(0.078, 0.36);
  yoke.rotation.z = Math.PI / 2;
  yoke.scale.set(1, 1, 0.8);
  girdle.add(yoke);
  /* Arms hang from the girdle's ends, so they ride its tilt. */
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.24, -0.02, 0);
    arm.rotation.z = side * tilt(5) - tilt(SHOULDER_TILT_DEG);
    const upper = capsule(0.056, 0.52);
    upper.position.set(0, -0.3, 0);
    const hand = sphere(0.06);
    hand.position.set(0, -0.62, 0);
    arm.add(upper, hand);
    girdle.add(arm);
  }
  const girdleHolder = new THREE.Group();
  girdleHolder.position.set(0, shoulderY, 0);
  girdle.position.set(0, 0, 0);
  girdleHolder.add(girdle);
  figure.add(girdleHolder);
  parts.push({ holder: girdleHolder, at: 0.55 });
  /* Neck and head. */
  const neck = capsule(0.046, 0.06);
  neck.position.set(0, 1.585, 0);
  addPart(neck, 0.68, new THREE.Vector3(0, 1.53, 0));
  const head = sphere(0.118);
  head.position.set(0, 1.735, 0.01);
  addPart(head, 0.78, new THREE.Vector3(0, 1.62, 0));

  /* Landmarks, computed from the posed girdle and pelvis, then laid on one
     measuring plane just behind the back (nearer the camera than any of the
     body), so the lines between them are never swallowed by the pelvis and
     read as a layer drawn over the figure once the camera squares up. */
  const MEASURE_Z = 0.17;
  figure.updateMatrixWorld(true);
  const onGirdle = (x) => {
    const at = new THREE.Vector3(x, 0.02, 0).applyMatrix4(girdle.matrixWorld);
    at.z = MEASURE_Z;
    return at;
  };
  const shoulderL = onGirdle(-0.22);
  const shoulderR = onGirdle(0.22);
  const hipAt = (x) => new THREE.Vector3(x, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt(HIP_TILT_DEG)).add(new THREE.Vector3(0, hipY, MEASURE_Z));
  const hipL = hipAt(-0.17);
  const hipR = hipAt(0.17);

  const glossy = (color, emissive = 0) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: color, emissiveIntensity: emissive,
  });
  const markerMat = glossy(COLORS.marker, 0.25);
  const points = [shoulderL, shoulderR, hipL, hipR].map((at, i) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), markerMat);
    dot.position.copy(at);
    dot.castShadow = true;
    scene.add(dot);
    return { dot, at: 1.15 + i * 0.12 };
  });

  /* Lines as tubes, drawn on by revealing their segments in order. */
  const tube = (from, to, radius, material) => {
    const geometry = new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 64, radius, 10, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    geometry.setDrawRange(0, 0);
    scene.add(mesh);
    const total = geometry.index.count;
    return { mesh, draw: (p) => geometry.setDrawRange(0, Math.floor(total * clamp01(p) / 60) * 60) };
  };
  const scrubMat = glossy(COLORS.scrub, 0.15);
  const plumbMat = glossy(COLORS.marker, 0.2);
  const levelMat = new THREE.MeshStandardMaterial({ color: COLORS.level, roughness: 0.6 });

  /* The plumb hangs in front of the back, between it and the camera, which
     is exactly what the camera's swing makes visible. */
  const plumbZ = 0.32;
  const plumb = tube(new THREE.Vector3(0, 2.08, plumbZ), new THREE.Vector3(0, 0.08, plumbZ), 0.007, plumbMat);
  const bob = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), plumbMat);
  bob.scale.set(0.8, 1.2, 0.8);
  bob.position.set(0, 0.05, plumbZ);
  bob.castShadow = true;
  scene.add(bob);

  const levelFrom = shoulderL.clone().add(new THREE.Vector3(-0.22, 0, 0));
  const levelTo = new THREE.Vector3(shoulderR.x + 0.22, shoulderL.y, shoulderL.z);
  const level = tube(levelFrom, levelTo, 0.0045, levelMat);
  const shoulderLine = tube(shoulderL, shoulderR, 0.011, scrubMat);
  const hipLine = tube(hipL, hipR, 0.009, scrubMat);

  /* Five framings: rounded frames standing behind the figure, each a little
     off from the others, the way five crops of one photo are. */
  const frames = [
    [0, 0, 1], [0.035, -0.02, 0.97], [-0.03, 0.025, 1.03], [0.02, 0.03, 0.95], [-0.02, -0.03, 1.02],
  ].map(([dx, dy, s], i) => {
    const shape = new THREE.Shape();
    const w = 0.92 * s; const h = 1.96 * s; const r = 0.09;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geometry = new THREE.BufferGeometry().setFromPoints(shape.getPoints(12));
    const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: COLORS.scrub, transparent: true, opacity: 0 }));
    line.position.set(dx, 0.98 + dy, -0.42 - i * 0.04);
    scene.add(line);
    return { line, at: 3.05 + i * 0.14 };
  });

  /* ------------------------------------------------------------ camera --- */

  const camera = new THREE.PerspectiveCamera(22, 3 / 4, 0.1, 40);
  const target = new THREE.Vector3(0, 0.98, 0);
  const FINAL_DISTANCE = 5.7;

  const placeCamera = (t) => {
    /* Three-quarters and a little above, swinging to square on by the time
       the lines are measured, and holding there. */
    const k = easeInOut(span(t, 0, 2.6));
    const azimuth = (1 - k) * 0.72;
    const elevation = (1 - k) * 0.3 + 0.015;
    const distance = FINAL_DISTANCE * (1 + (1 - k) * 0.12);
    camera.position.set(
      target.x + distance * Math.sin(azimuth) * Math.cos(elevation),
      target.y + distance * Math.sin(elevation),
      target.z + distance * Math.cos(azimuth) * Math.cos(elevation),
    );
    camera.lookAt(target);
  };

  /* ------------------------------------------------------------- render --- */

  let progress = 0;
  let width = 0;
  let height = 0;

  const resize = () => {
    const box = host.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };

  function render(now = performance.now()) {
    const t = progress * timelineDuration;

    for (const part of parts) {
      const k = span(t, part.at, part.at + 0.38);
      const s = k <= 0 ? 0.0001 : easeOutBack(k);
      part.holder.scale.setScalar(s);
      part.holder.visible = k > 0;
    }
    for (const point of points) {
      const k = span(t, point.at, point.at + 0.3);
      point.dot.visible = k > 0;
      point.dot.scale.setScalar(k <= 0 ? 0.0001 : easeOutBack(k));
    }
    plumb.draw(span(t, 0, 0.7));
    bob.visible = t > 0.6;
    bob.scale.setScalar(0.0001 + easeOutBack(span(t, 0.6, 0.9)));
    level.draw(span(t, 2.0, 2.5));
    shoulderLine.draw(span(t, 2.2, 2.75));
    hipLine.draw(span(t, 2.35, 2.9));
    for (const frame of frames) frame.line.material.opacity = 0.55 * span(t, frame.at, frame.at + 0.3);

    /* The key light drifts slowly, so the glints travel over the clay. */
    const drift = now / 1000;
    key.position.x = -2.4 + Math.sin(drift * 0.5) * 0.8;
    key.position.z = 3.4 + Math.cos(drift * 0.4) * 0.6;

    placeCamera(t);
    renderer.render(scene, camera);
  }

  /* Render on demand from the scrub, plus a slow loop for the light while the
     figure is on screen. */
  let visible = false;
  let loop = 0;
  const tick = (now) => {
    render(now);
    loop = visible ? requestAnimationFrame(tick) : 0;
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !loop) loop = requestAnimationFrame(tick);
  });
  io.observe(host);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  host.classList.add('is-3d');

  return {
    setProgress(p) {
      progress = clamp01(p);
      if (!loop) render();
    },
    destroy() {
      visible = false;
      cancelAnimationFrame(loop);
      io.disconnect();
      ro.disconnect();
      host.classList.remove('is-3d');
      canvas.remove();
      scene.traverse((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material?.dispose?.());
      });
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
