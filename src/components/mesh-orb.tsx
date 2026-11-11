"use client";
import { useEffect, useRef } from "react";

type Point = { x: number; y: number; z: number };
const count = 240;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const points: Point[] = Array.from({ length: count }, (_, index) => {
  const y = 1 - (index / (count - 1)) * 2;
  const radius = Math.sqrt(1 - y * y);
  const angle = goldenAngle * index;
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
});
// Neighbor connections are fixed. Frames only rotate and project the mesh.
const edges: [number, number][] = [];
for (let a = 0; a < count; a++) {
  for (let b = a + 1; b < count; b++) {
    const p = points[a],
      q = points[b];
    if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.29) edges.push([a, b]);
  }
}

export function MeshOrb() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      width = 0,
      height = 0;
    const started = performance.now();
    const draw = (timestamp: number) => {
      const time = motion.matches ? 0 : (timestamp - started) / 1000;
      const breath = 1 + 0.045 * Math.sin(time * 1.05);
      const radius = Math.min(width, height) * 0.35 * breath;
      const rotation = time * 0.13;
      const tilt = 0.25 + Math.sin(time * 0.17) * 0.08;
      const centerY = height * 0.46 + Math.sin(time * 0.72) * 3;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(43, 58, 65, 0.035)";
      context.beginPath();
      context.ellipse(
        width / 2,
        height * 0.91,
        radius * 0.61,
        5,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
      const projected = points.map((p) => {
        const x = p.x * Math.cos(rotation) - p.z * Math.sin(rotation);
        const z0 = p.x * Math.sin(rotation) + p.z * Math.cos(rotation);
        const y = p.y * Math.cos(tilt) - z0 * Math.sin(tilt);
        const z = p.y * Math.sin(tilt) + z0 * Math.cos(tilt);
        const perspective = 4 / (4 - z);
        return {
          x: width / 2 + x * radius * perspective,
          y: centerY + y * radius * perspective,
          z,
        };
      });
      const color = (index: number) =>
        points[index].y > 0.22
          ? "31, 177, 164"
          : points[index].x > 0.05
            ? "243, 130, 88"
            : "139, 117, 214";
      for (const [a, b] of edges) {
        const p = projected[a],
          q = projected[b];
        const depth = ((p.z + q.z) / 2 + 1) / 2;
        context.strokeStyle = `rgba(${color(a)}, ${0.12 + depth * 0.43})`;
        context.lineWidth = 0.65 + depth * 0.35;
        context.beginPath();
        context.moveTo(p.x, p.y);
        context.lineTo(q.x, q.y);
        context.stroke();
      }
      const order = projected
        .map((p, index) => ({ ...p, index }))
        .sort((a, b) => a.z - b.z);
      for (const p of order) {
        const depth = (p.z + 1) / 2;
        context.fillStyle = `rgba(${color(p.index)}, ${0.28 + depth * 0.65})`;
        context.beginPath();
        context.arc(p.x, p.y, 0.7 + depth * 1.05, 0, Math.PI * 2);
        context.fill();
      }
      if (!motion.matches && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
    };
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = width * dpr;
      element.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      restart();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    motion.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="mesh-orb"
      role="img"
      aria-label="A gently breathing mesh sphere"
    />
  );
}
