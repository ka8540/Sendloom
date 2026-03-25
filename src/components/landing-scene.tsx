"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function LandingScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.3, 8.4);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const ambientLight = new THREE.AmbientLight(0xf5f0e8, 0.9);
    const hemisphereLight = new THREE.HemisphereLight(0xfff5de, 0x0b1920, 1.35);
    const keyLight = new THREE.DirectionalLight(0xe5fff1, 2.6);
    keyLight.position.set(4.5, 5.5, 5);
    const rimLight = new THREE.PointLight(0xffa24b, 28, 18, 2);
    rimLight.position.set(-3.4, -1.8, 4.8);

    scene.add(ambientLight, hemisphereLight, keyLight, rimLight);

    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x1b8b69,
      roughness: 0.18,
      metalness: 0.72,
      transmission: 0.16,
      thickness: 0.9,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      emissive: 0x06271f,
      emissiveIntensity: 0.8
    });
    const core = new THREE.Mesh(new THREE.TorusKnotGeometry(1.55, 0.34, 240, 28), coreMaterial);
    root.add(core);

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcb7e,
      transparent: true,
      opacity: 0.14,
      wireframe: true
    });
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5, 1), haloMaterial);
    root.add(halo);

    const orbitMaterial = new THREE.MeshBasicMaterial({
      color: 0xdafbe5,
      transparent: true,
      opacity: 0.2
    });
    const orbitA = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.03, 16, 160), orbitMaterial);
    orbitA.rotation.x = Math.PI / 2.4;
    orbitA.rotation.y = Math.PI / 6;
    const orbitB = orbitA.clone();
    orbitB.rotation.x = Math.PI / 1.9;
    orbitB.rotation.z = Math.PI / 3.4;
    const orbitC = orbitA.clone();
    orbitC.rotation.y = Math.PI / 1.8;
    orbitC.rotation.z = Math.PI / 5.5;
    root.add(orbitA, orbitB, orbitC);

    const packetGeometry = new THREE.BoxGeometry(0.62, 0.34, 0.11);
    const packetMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf7f2e8,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 0.82,
      clearcoatRoughness: 0.15,
      emissive: 0x1a312a,
      emissiveIntensity: 0.08
    });
    const packetCount = 18;
    const packets = new THREE.InstancedMesh(packetGeometry, packetMaterial, packetCount);
    root.add(packets);

    const streakGeometry = new THREE.BufferGeometry();
    const streakCount = 180;
    const positions = new Float32Array(streakCount * 3);
    for (let index = 0; index < streakCount; index += 1) {
      const radius = 4 + Math.random() * 4.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
      positions[index * 3 + 2] = radius * Math.cos(phi);
    }
    streakGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const streaks = new THREE.Points(
      streakGeometry,
      new THREE.PointsMaterial({
        color: 0xf6e7bf,
        size: 0.06,
        transparent: true,
        opacity: 0.85
      })
    );
    root.add(streaks);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0x2ec28c,
        transparent: true,
        opacity: 0.18
      })
    );
    glow.scale.set(7.4, 7.4, 1);
    root.add(glow);

    const pointer = new THREE.Vector2(0, 0);
    const targetRotation = new THREE.Vector2(0, 0);
    const dummy = new THREE.Object3D();
    const clock = new THREE.Clock();

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const handlePointerLeave = () => {
      pointer.set(0, 0);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    mount.addEventListener("pointermove", handlePointerMove);
    mount.addEventListener("pointerleave", handlePointerLeave);
    resize();

    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();

      targetRotation.x += ((pointer.y * 0.45) - targetRotation.x) * 0.04;
      targetRotation.y += ((pointer.x * 0.55) - targetRotation.y) * 0.04;

      root.rotation.x = targetRotation.x + Math.sin(elapsed * 0.34) * 0.08;
      root.rotation.y = targetRotation.y + elapsed * 0.18;

      core.rotation.x = elapsed * 0.42;
      core.rotation.y = elapsed * 0.55;
      halo.rotation.x = elapsed * 0.12;
      halo.rotation.y = -elapsed * 0.1;
      streaks.rotation.y = elapsed * 0.06;
      streaks.rotation.x = Math.sin(elapsed * 0.15) * 0.08;

      for (let index = 0; index < packetCount; index += 1) {
        const lane = index % 3;
        const radius = 2.15 + lane * 0.58;
        const speed = 0.45 + lane * 0.08;
        const angle = elapsed * speed + index * 0.72;
        const vertical = Math.sin(elapsed * 0.9 + index) * 0.2 + (lane - 1) * 0.48;

        dummy.position.set(
          Math.cos(angle) * radius,
          vertical,
          Math.sin(angle) * radius * 0.7
        );
        dummy.lookAt(0, vertical * 0.35, 0);
        dummy.rotateZ(Math.sin(elapsed + index) * 0.35);
        dummy.updateMatrix();
        packets.setMatrixAt(index, dummy.matrix);
      }

      packets.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
    });

    return () => {
      resizeObserver.disconnect();
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerleave", handlePointerLeave);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      packetGeometry.dispose();
      packetMaterial.dispose();
      core.geometry.dispose();
      coreMaterial.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      orbitA.geometry.dispose();
      orbitMaterial.dispose();
      streakGeometry.dispose();
      (streaks.material as THREE.Material).dispose();
      (glow.material as THREE.Material).dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} aria-hidden="true" />;
}
