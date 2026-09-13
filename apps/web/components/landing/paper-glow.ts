// Masks share the paper-ribbon.webp source coordinate system (1448 × 1086).
// Only transparent light is rendered: the original image and HTML remain intact.
const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const fragmentSource = `
precision mediump float;
varying vec2 uv;
uniform sampler2D edgeMask;
uniform sampler2D softMask;
uniform vec2 sourceScale;
uniform vec2 sourceOffset;
uniform float strength;
void main() {
  vec2 sourceUV = uv * sourceScale + sourceOffset;
  if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) discard;
  float edge = texture2D(edgeMask, sourceUV).a;
  float soft = texture2D(softMask, sourceUV).a;
  float alpha = clamp((edge * 0.66 + soft * 0.5) * strength, 0.0, 0.72);
  vec3 warm = mix(vec3(1.0, 0.71, 0.20), vec3(1.0, 0.88, 0.48), edge);
  gl_FragColor = vec4(warm * alpha, alpha);
}`;

function loadMask(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    const clear = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clear();
      image.src = "";
      reject(new Error("Aborted"));
    };
    image.onload = () => {
      clear();
      resolve(image);
    };
    image.onerror = () => {
      clear();
      reject(new Error("Mask unavailable"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    image.src = src;
  });
}

export async function createPaperGlow(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
) {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const dispose = () => {
    textures.forEach((texture) => gl.deleteTexture(texture));
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
  try {
    const masks = await Promise.all([
      loadMask("/landing/paper-edge-mask.svg", signal),
      loadMask("/landing/paper-glow-mask.svg", signal),
    ]);
    if (signal.aborted || gl.isContextLost()) {
      dispose();
      return null;
    }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Shader unavailable");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Shader failed");
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error("Program unavailable");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Link failed");
    gl.useProgram(program);
    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Buffer unavailable");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    masks.forEach((mask, index) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Texture unavailable");
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
      gl.uniform1i(
        gl.getUniformLocation(program!, index === 0 ? "edgeMask" : "softMask"),
        index,
      );
    });
    const scale = gl.getUniformLocation(program, "sourceScale");
    const offset = gl.getUniformLocation(program, "sourceOffset");
    const intensity = gl.getUniformLocation(program, "strength");
    const draw = (strength: number) => {
      if (signal.aborted || gl.isContextLost()) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        1920 / width,
        1440 / height,
      );
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Read the actual image fit and position so CSS changes cannot detach the masks.
      const image = canvas.parentElement?.querySelector("img");
      const style = image ? getComputedStyle(image) : null;
      const fit =
        style?.objectFit === "contain"
          ? Math.min(width / 1448, height / 1086)
          : Math.max(width / 1448, height / 1086);
      const [x = "50%", y = "50%"] = (style?.objectPosition ?? "50% 50%").split(
        " ",
      );
      const position = (value: string, space: number) =>
        value.endsWith("%")
          ? (space * Number.parseFloat(value)) / 100
          : Number.parseFloat(value) || 0;
      gl.uniform2f(scale, width / (1448 * fit), height / (1086 * fit));
      gl.uniform2f(
        offset,
        -position(x, width - 1448 * fit) / (1448 * fit),
        -position(y, height - 1086 * fit) / (1086 * fit),
      );
      gl.uniform1f(intensity, strength);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    return { draw, dispose };
  } catch {
    dispose();
    return null;
  }
}
