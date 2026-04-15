// manim-runner.js
// 5-stage runtime manim pipeline used by the manim-agent.
//
// Exports:
//   checkDependencies() -> { manim, ffmpeg, ffprobe } booleans
//   runManimPipeline({ sceneSource, sceneName, targetMp4Path, timeoutMs })
//     -> { ok, mp4Path?, previewPngPath?, keyframePaths?, durationSec?, reason? }
//
// Invariants:
//   - Never throws. All errors flow back as { ok: false, reason }.
//   - Each stage has its own kill-on-timeout budget.
//   - Scratch dir is per-call: manim_scratch/<agentId>/

import { spawn, execSync } from "child_process";
import { promises as fsp } from "fs";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_ROOT = path.join(__dirname, "manim_scratch");

// Per-stage timeout budgets (ms).
const DRY_RUN_MS = 15_000;
const PREVIEW_MS = 30_000;
const FFPROBE_MS = 10_000;
const FFMPEG_MS = 10_000;

// On Windows, shell=true lets us resolve .bat/.cmd shims (manim is one).
const SPAWN_OPTS_BASE = process.platform === "win32" ? { shell: true } : {};

/**
 * Run a child process with a hard timeout. Resolves with { code, stdout, stderr, timedOut }.
 * Never rejects.
 */
function runProc(cmd, args, { cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    let child;
    try {
      child = spawn(cmd, args, { cwd, ...SPAWN_OPTS_BASE });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err && err.message || err), timedOut: false, spawnError: true });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout && child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr && child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err && err.message || err), timedOut, spawnError: true });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut, spawnError: false });
    });
  });
}

/**
 * Check availability of manim, ffmpeg, ffprobe on the host.
 * Uses execSync with a short timeout. Catches errors per tool.
 */
export async function checkDependencies() {
  const result = { manim: false, ffmpeg: false, ffprobe: false };
  const probes = [
    ["manim", ["--version"]],
    ["ffmpeg", ["-version"]],
    ["ffprobe", ["-version"]],
  ];
  for (const [tool, args] of probes) {
    try {
      execSync(`${tool} ${args.join(" ")}`, {
        stdio: "ignore",
        timeout: 5_000,
        windowsHide: true,
      });
      result[tool] = true;
    } catch {
      result[tool] = false;
    }
  }
  return result;
}

/**
 * Generate a unique agent id for a scratch subdirectory.
 */
function makeAgentId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

/**
 * Ensure a directory exists.
 */
async function ensureDir(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `mkdir failed: ${err && err.message || err}` };
  }
}

/**
 * Copy a file and return { ok, reason? }.
 */
async function copyFile(src, dst) {
  try {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(src, dst);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `copy ${src} -> ${dst} failed: ${err && err.message || err}` };
  }
}

/**
 * Parse ffprobe JSON and return { codecName, width, height, durationSec } or null.
 */
function parseFfprobe(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const stream = parsed && parsed.streams && parsed.streams[0];
    if (!stream) return null;
    const durationSec = parseFloat(stream.duration);
    return {
      codecName: stream.codec_name,
      width: stream.width,
      height: stream.height,
      durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Run the 5-stage manim pipeline.
 */
export async function runManimPipeline({ sceneSource, sceneName, targetMp4Path, timeoutMs = 300_000 }) {
  // Guard arguments early.
  if (typeof sceneSource !== "string" || !sceneSource.trim()) {
    return { ok: false, reason: "runManimPipeline: sceneSource must be a non-empty string" };
  }
  if (typeof sceneName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sceneName)) {
    return { ok: false, reason: `runManimPipeline: invalid sceneName "${sceneName}"` };
  }
  if (typeof targetMp4Path !== "string" || !targetMp4Path.trim()) {
    return { ok: false, reason: "runManimPipeline: targetMp4Path must be a non-empty string" };
  }

  // Stage 0: scratch setup.
  const agentId = makeAgentId();
  const scratchDir = path.join(SCRATCH_ROOT, agentId);
  const rootEnsured = await ensureDir(SCRATCH_ROOT);
  if (!rootEnsured.ok) return { ok: false, reason: rootEnsured.reason };
  const scratchEnsured = await ensureDir(scratchDir);
  if (!scratchEnsured.ok) return { ok: false, reason: scratchEnsured.reason };

  const scenePath = path.join(scratchDir, "scene.py");
  try {
    await fsp.writeFile(scenePath, sceneSource, "utf8");
  } catch (err) {
    return { ok: false, reason: `write scene.py failed: ${err && err.message || err}` };
  }

  // Stage 1: dry run. Catches syntax / API errors in a few seconds.
  const dryRun = await runProc(
    "manim",
    ["--dry_run", "scene.py", sceneName],
    { cwd: scratchDir, timeoutMs: DRY_RUN_MS },
  );
  if (dryRun.spawnError) {
    return { ok: false, reason: `dry-run failed to spawn manim: ${dryRun.stderr}` };
  }
  if (dryRun.timedOut) {
    return { ok: false, reason: `dry-run timed out after ${DRY_RUN_MS}ms` };
  }
  if (dryRun.code !== 0) {
    return { ok: false, reason: `dry-run failed: ${dryRun.stderr || dryRun.stdout}` };
  }

  // Stage 2: low-quality still preview. -ql lowest quality, -s save last frame only.
  const preview = await runProc(
    "manim",
    ["-ql", "-s", "scene.py", sceneName],
    { cwd: scratchDir, timeoutMs: PREVIEW_MS },
  );
  if (preview.spawnError) {
    return { ok: false, reason: `preview failed to spawn manim: ${preview.stderr}` };
  }
  if (preview.timedOut) {
    return { ok: false, reason: `preview timed out after ${PREVIEW_MS}ms` };
  }
  if (preview.code !== 0) {
    return { ok: false, reason: `preview failed: ${preview.stderr || preview.stdout}` };
  }

  // Manim Community writes stills to media/images/<module>/<SceneName>.png.
  // Search both standard layouts defensively.
  const previewCandidates = [
    path.join(scratchDir, "media", "images", "scene", `${sceneName}.png`),
    path.join(scratchDir, "media", "images", "scene", `${sceneName}_ManimCE_v0.20.1.png`),
  ];
  let previewSrc = null;
  for (const cand of previewCandidates) {
    if (existsSync(cand)) { previewSrc = cand; break; }
  }
  if (!previewSrc) {
    // Fallback: glob the images dir.
    try {
      const imgDir = path.join(scratchDir, "media", "images", "scene");
      const entries = await fsp.readdir(imgDir);
      const hit = entries.find((e) => e.startsWith(sceneName) && e.endsWith(".png"));
      if (hit) previewSrc = path.join(imgDir, hit);
    } catch { /* ignore */ }
  }
  if (!previewSrc) {
    return { ok: false, reason: `preview stage produced no PNG under media/images/scene/${sceneName}*.png` };
  }

  const previewPngPath = path.join(scratchDir, `${sceneName}_preview.png`);
  const previewCopy = await copyFile(previewSrc, previewPngPath);
  if (!previewCopy.ok) return { ok: false, reason: previewCopy.reason };

  // Stage 3: full render at medium quality (720p30).
  const render = await runProc(
    "manim",
    ["-qm", "scene.py", sceneName],
    { cwd: scratchDir, timeoutMs },
  );
  if (render.spawnError) {
    return { ok: false, reason: `render failed to spawn manim: ${render.stderr}` };
  }
  if (render.timedOut) {
    return { ok: false, reason: `render timed out after ${timeoutMs}ms` };
  }
  if (render.code !== 0) {
    return { ok: false, reason: `render failed: ${render.stderr || render.stdout}` };
  }

  // Locate the rendered mp4.
  const mp4Candidate = path.join(scratchDir, "media", "videos", "scene", "720p30", `${sceneName}.mp4`);
  let mp4Src = existsSync(mp4Candidate) ? mp4Candidate : null;
  if (!mp4Src) {
    try {
      const vidDir = path.join(scratchDir, "media", "videos", "scene", "720p30");
      const entries = await fsp.readdir(vidDir);
      const hit = entries.find((e) => e.startsWith(sceneName) && e.endsWith(".mp4"));
      if (hit) mp4Src = path.join(vidDir, hit);
    } catch { /* ignore */ }
  }
  if (!mp4Src) {
    return { ok: false, reason: `render produced no mp4 under media/videos/scene/720p30/${sceneName}.mp4` };
  }

  const mp4Copy = await copyFile(mp4Src, targetMp4Path);
  if (!mp4Copy.ok) return { ok: false, reason: mp4Copy.reason };

  // Stage 4: ffprobe metadata check.
  const probe = await runProc(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration,codec_name",
      "-of", "json",
      targetMp4Path,
    ],
    { timeoutMs: FFPROBE_MS },
  );
  if (probe.spawnError) {
    return { ok: false, reason: `ffprobe failed to spawn: ${probe.stderr}` };
  }
  if (probe.timedOut) {
    return { ok: false, reason: `ffprobe timed out after ${FFPROBE_MS}ms` };
  }
  if (probe.code !== 0) {
    return { ok: false, reason: `ffprobe failed: ${probe.stderr || probe.stdout}` };
  }
  const meta = parseFfprobe(probe.stdout);
  if (!meta) {
    return { ok: false, reason: `ffprobe returned unparseable JSON: ${probe.stdout.slice(0, 200)}` };
  }
  if (meta.codecName !== "h264") {
    return { ok: false, reason: `unexpected codec: ${meta.codecName} (wanted h264)` };
  }
  if (!(meta.durationSec > 0)) {
    return { ok: false, reason: `zero or missing duration in ffprobe output` };
  }

  // Stage 5: extract 3 keyframes at 0, 50%, end (clamped a tick before the end).
  const endTime = Math.max(meta.durationSec - 0.05, meta.durationSec * 0.99);
  const times = [0, meta.durationSec / 2, endTime];
  const labels = ["start", "mid", "end"];
  const keyframePaths = [];
  for (let i = 0; i < 3; i++) {
    const outPng = path.join(scratchDir, `${labels[i]}.png`);
    const kf = await runProc(
      "ffmpeg",
      [
        "-y",
        "-ss", String(times[i].toFixed(3)),
        "-i", targetMp4Path,
        "-vframes", "1",
        outPng,
      ],
      { timeoutMs: FFMPEG_MS },
    );
    if (kf.spawnError) {
      return { ok: false, reason: `ffmpeg keyframe ${labels[i]} failed to spawn: ${kf.stderr}` };
    }
    if (kf.timedOut) {
      return { ok: false, reason: `ffmpeg keyframe ${labels[i]} timed out after ${FFMPEG_MS}ms` };
    }
    if (kf.code !== 0 || !existsSync(outPng)) {
      return { ok: false, reason: `ffmpeg keyframe ${labels[i]} failed: ${kf.stderr || kf.stdout}` };
    }
    keyframePaths.push(outPng);
  }

  return {
    ok: true,
    mp4Path: targetMp4Path,
    previewPngPath,
    keyframePaths,
    durationSec: meta.durationSec,
  };
}
