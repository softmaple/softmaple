"use client";

import { useEffect, useRef } from "react";

/**
 * A single full-bleed fragment shader behind the landing content: paper grain,
 * a laid-paper fibre, and two very slow light pools that sit behind the
 * headline and the product window. It is deliberately quiet — peak opacity is
 * a few percent — so it reads as the texture of the page rather than as
 * decoration. When WebGL is unavailable the CSS gradient underneath is the
 * whole effect, so nothing depends on this component rendering.
 */

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uStrength;

/**
 * Hash on a wrapped cell rather than raw coordinates. mediump tops out at
 * 65504, and dot(gl_FragCoord.xy, ...) on a wide viewport runs past that into
 * Inf, which makes sin() NaN and paints the whole layer opaque. Wrapping first
 * keeps the sine argument under 100 on every driver.
 */
float hash(vec2 p) {
  return fract(sin(dot(fract(p * 0.0009765625), vec2(12.9898, 78.233))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 blend = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x),
    blend.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Wrapped so the clock never grows into the range where precision fails.
  float t = mod(uTime, 256.0);

  // Light pools breathe on a ~30s cycle: present, never animated-looking.
  vec2 warmAt = vec2(0.27 * aspect, 0.74 + 0.010 * sin(t * 0.21));
  vec2 coolAt = vec2(0.79 * aspect, 0.47 + 0.013 * cos(t * 0.17));
  float warm = exp(-dot(p - warmAt, p - warmAt) * 15.0);
  float cool = exp(-dot(p - coolAt, p - coolAt) * 16.0);

  // Laid-paper fibre: two stretched noise fields crossing at right angles.
  float fibre =
    valueNoise(vec2(uv.x * 380.0, uv.y * 80.0)) * 0.6 +
    valueNoise(vec2(uv.x * 80.0, uv.y * 380.0)) * 0.4;
  float grain = hash(gl_FragCoord.xy + floor(t * 8.0)) - 0.5;

  vec3 colour = uPaper;
  colour += uWarm * warm * 0.45;
  colour += uCool * cool * 0.35;
  colour += (fibre - 0.5) * 0.22;
  colour += grain * 0.16;

  float alpha = (0.032 + warm * 0.035 + cool * 0.026) * uStrength;

  // Premultiplied: the canvas composites with premultipliedAlpha (the default),
  // so full-intensity RGB behind a small alpha reads as super-luminous and
  // washes the page out. Multiply through and it composites as plain alpha-over.
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0) * alpha, alpha);
}
`;

const compile = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
};

const readColour = (styles: CSSStyleDeclaration, name: string): number[] => {
  const parts = styles
    .getPropertyValue(name)
    .trim()
    .split(/[\s,]+/);
  return parts.length === 3
    ? parts.map((part) => Number.parseFloat(part) / 255)
    : [0, 0, 0];
};

const prefersStillness = (): boolean =>
  document.documentElement.dataset.reducedMotion === "true" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LandingAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    // A remount can hand back a context that is already gone; the CSS gradient
    // underneath is the whole effect in that case.
    if (gl === null || gl.isContextLost()) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (vertex === null || fragment === null || program === null) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uResolution = uniform("uResolution");
    const uTime = uniform("uTime");
    const uPaper = uniform("uPaper");
    const uWarm = uniform("uWarm");
    const uCool = uniform("uCool");
    const uStrength = uniform("uStrength");

    const applyPalette = () => {
      const styles = getComputedStyle(document.documentElement);
      gl.uniform3fv(uPaper, readColour(styles, "--atmosphere-paper"));
      gl.uniform3fv(uWarm, readColour(styles, "--atmosphere-warm"));
      gl.uniform3fv(uCool, readColour(styles, "--atmosphere-cool"));
      gl.uniform1f(
        uStrength,
        Number.parseFloat(styles.getPropertyValue("--atmosphere-strength")) ||
          1,
      );
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      // The viewport and the resolution belong to the program, not the element,
      // so they are uploaded every pass. A remount reuses the same canvas at the
      // same size with a fresh program: skipping these leaves uResolution at
      // (0, 0), every uv divides by zero, and the sheet paints NaN-white.
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uResolution, width, height);
    };

    let frame = 0;
    let visible = true;
    let checked = false;
    const start = performance.now();

    /**
     * A layer this quiet is never worth a broken page: if the driver cannot
     * draw it, drop the canvas and let the CSS gradient underneath be the
     * whole effect rather than leaving a mispainted sheet over the content.
     */
    const abandon = () => {
      stop();
      canvas.hidden = true;
    };

    const draw = (time: number) => {
      gl.uniform1f(uTime, (time - start) / 1000);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (checked) return;
      checked = true;
      if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) abandon();
    };

    const loop = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(loop);
    };

    function stop() {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    }

    const render = () => {
      stop();
      if (canvas.hidden || gl.isContextLost()) return;
      applyPalette();
      resize();
      if (!visible || document.hidden) return;
      if (prefersStillness()) {
        draw(start);
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        render();
      },
      { rootMargin: "120px" },
    );
    observer.observe(canvas);

    // The palette lives in CSS custom properties, so a theme switch (which
    // toggles a class on <html>) is the signal to re-read it.
    const themes = new MutationObserver(render);
    themes.observe(document.documentElement, {
      attributeFilter: ["class", "data-reduced-motion"],
    });
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", render);
    const sizes = new ResizeObserver(render);
    sizes.observe(canvas);
    document.addEventListener("visibilitychange", render);
    canvas.addEventListener("webglcontextlost", abandon);

    render();

    return () => {
      stop();
      observer.disconnect();
      themes.disconnect();
      motion.removeEventListener("change", render);
      sizes.disconnect();
      document.removeEventListener("visibilitychange", render);
      canvas.removeEventListener("webglcontextlost", abandon);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return (
    <div className="landing-atmosphere" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
