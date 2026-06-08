/* ================================================================
   CamMaster — 3D Particle Sphere Background (Three.js)
   A rotating dotted globe that follows the mouse cursor smoothly.
   Loads Three.js r160 from jsDelivr CDN then self-initialises.
   Canvas: position:fixed; z-index:-999; pointer-events:none
================================================================ */
(function () {
  'use strict';

  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js';

  let _renderer, _scene, _camera, _sphere1, _sphere2, _sphere3;
  let _rafId = null;
  let _clock  = 0;              // manual clock (avoids Date.now() precision drift)
  let _targetX = 0, _targetY = 0;
  let _currX   = 0, _currY   = 0;

  /* ── Bootstrap ──────────────────────────────────────────────── */
  function _bootstrap() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return; // page doesn't have the bg canvas

    /* Performance: skip the heavy 3D WebGL background on phones and for
       users who prefer reduced motion. It is purely decorative and barely
       visible on small screens. Skipping avoids a ~600KB Three.js download
       + a continuous render loop — sharply improves mobile PageSpeed and
       saves battery. */
    var _skip3D = false;
    try {
      _skip3D = window.matchMedia('(max-width: 1024px)').matches
             || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    if (_skip3D) { canvas.style.display = 'none'; return; }

    // Apply fixed-background styles before Three.js touches the canvas
    const s = canvas.style;
    s.position      = 'fixed';
    s.top           = '0';
    s.left          = '0';
    s.width         = '100vw';
    s.height        = '100vh';
    s.zIndex        = '-10';
    s.pointerEvents = 'none';
    s.opacity       = '0.18';

    if (window.THREE) {
      _setupScene(canvas);
    } else {
      const tag  = document.createElement('script');
      tag.src    = THREE_CDN;
      tag.onload = () => _setupScene(canvas);
      tag.onerror = () => console.warn('[3D Sphere] Three.js CDN failed — decorative sphere disabled.');
      document.head.appendChild(tag);
    }
  }

  /* ── Scene Setup ─────────────────────────────────────────────── */
  function _setupScene(canvas) {
    const W = window.innerWidth;
    const H = window.innerHeight;

    /* Renderer */
    _renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(W, H);
    _renderer.setClearColor(0x000000, 0);

    /* Scene + Camera */
    _scene  = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
    _camera.position.z = 4.2;

    /* ── Sphere 1: inner — brand orange, dense dots ────────────── */
    const geo1 = new THREE.SphereGeometry(1.6, 52, 52);
    const mat1 = new THREE.PointsMaterial({
      color: 0xff6333, size: 0.018,
      transparent: true, opacity: 0.40,
      sizeAttenuation: true,
    });
    _sphere1 = new THREE.Points(geo1, mat1);
    _scene.add(_sphere1);

    /* ── Sphere 2: mid — purple, sparser ──────────────────────── */
    const geo2 = new THREE.SphereGeometry(2.2, 36, 36);
    const mat2 = new THREE.PointsMaterial({
      color: 0xb43cdc, size: 0.013,
      transparent: true, opacity: 0.16,
      sizeAttenuation: true,
    });
    _sphere2 = new THREE.Points(geo2, mat2);
    _scene.add(_sphere2);

    /* ── Sphere 3: outer shell — electric blue, very sparse ────── */
    const geo3 = new THREE.SphereGeometry(2.9, 22, 22);
    const mat3 = new THREE.PointsMaterial({
      color: 0x3c9eff, size: 0.008,
      transparent: true, opacity: 0.09,
      sizeAttenuation: true,
    });
    _sphere3 = new THREE.Points(geo3, mat3);
    _scene.add(_sphere3);

    /* Events */
    window.addEventListener('mousemove',  _onMouse,  { passive: true });
    window.addEventListener('touchmove',  _onTouch,  { passive: true });
    window.addEventListener('mouseleave', _onLeave,  { passive: true });
    window.addEventListener('resize',     _onResize, { passive: true });

    /* Kick off render loop */
    _rafId = requestAnimationFrame(_loop);
    console.log('✓ Three.js 3D sphere background active');
  }

  /* ── Input handlers ──────────────────────────────────────────── */
  function _onMouse(e) {
    _targetX = (e.clientX / window.innerWidth  - 0.5) * Math.PI * 1.1;
    _targetY = (e.clientY / window.innerHeight - 0.5) * Math.PI * 0.65;
  }
  function _onTouch(e) {
    if (!e.touches[0]) return;
    _targetX = (e.touches[0].clientX / window.innerWidth  - 0.5) * Math.PI * 1.1;
    _targetY = (e.touches[0].clientY / window.innerHeight - 0.5) * Math.PI * 0.65;
  }
  function _onLeave() {
    _targetX = 0; _targetY = 0;
  }
  function _onResize() {
    if (!_renderer || !_camera) return;
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
    _renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ── Render loop ─────────────────────────────────────────────── */
  function _loop() {
    _rafId = requestAnimationFrame(_loop);

    /* Smooth interpolation toward cursor target */
    _currX += (_targetX - _currX) * 0.032;
    _currY += (_targetY - _currY) * 0.032;

    /* Advance manual clock */
    _clock += 0.006;

    /* Sphere 1 — cursor-driven + slow auto-spin */
    if (_sphere1) {
      _sphere1.rotation.y = _currX + _clock * 0.28;
      _sphere1.rotation.x = _currY;
    }
    /* Sphere 2 — counter-rotates gently */
    if (_sphere2) {
      _sphere2.rotation.y = -_currX * 0.55 - _clock * 0.18;
      _sphere2.rotation.x =  _currY * 0.40;
    }
    /* Sphere 3 — barely moves, subtle parallax */
    if (_sphere3) {
      _sphere3.rotation.y = _currX * 0.25 + _clock * 0.10;
      _sphere3.rotation.x = -_currY * 0.20;
    }

    if (_renderer && _scene && _camera) {
      _renderer.render(_scene, _camera);
    }
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.ParticleSystem = {
    pause:  () => { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } },
    resume: () => { if (!_rafId && _renderer) _rafId = requestAnimationFrame(_loop); },
    setOpacity: (v) => {
      [_sphere1, _sphere2, _sphere3].forEach(s => {
        if (s) s.material.opacity = v;
      });
    },
  };

  /* ── Auto-init ───────────────────────────────────────────────── */
  // Defer the 3D sphere until the browser is idle so it never contributes
  // to Total Blocking Time. The sphere is decorative — a few hundred ms
  // delay before it appears is invisible to users.
  function _deferredBootstrap() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(_bootstrap, { timeout: 2000 });
    } else {
      setTimeout(_bootstrap, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _deferredBootstrap);
  } else {
    _deferredBootstrap();
  }
})();
