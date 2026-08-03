import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MODEL_PATH = "/models/leviathan_axe_optimized.glb";

/**
 * EDIT ME — this is the actual event schedule. Swap in Deviathon's real
 * dates/phases; everything below (spine, markers, axe path, card layout)
 * adapts automatically to however many entries are here.
 */
const TIMELINE = [
  {
    id: "open",
    tag: "DAY 00",
    phase: "REGISTRATIONS OPEN",
    title: "THE CALL TO ARMS",
    body: "The gates of Deviathon open. Builders, gather your parties and answer the summons.",
  },
  {
    id: "lock",
    tag: "DAY 05",
    phase: "TEAM LOCK",
    title: "THE GATES SEAL SHUT",
    body: "Rosters freeze at midnight. Whoever stands beside you now stands with you to the end.",
  },
  {
    id: "round1",
    tag: "DAY 06",
    phase: "ROUND 1 · SUBMISSIONS",
    title: "TRIAL OF IDEAS",
    body: "Every team puts steel to stone. Submit your concept before the first trial closes.",
  },
  {
    id: "round2",
    tag: "DAY 10",
    phase: "ROUND 2 · SHORTLIST",
    title: "THE CHOSEN FEW",
    body: "The strongest ideas are named. Shortlisted teams are summoned to the final hall.",
  },
  {
    id: "finale",
    tag: "DAY 15–16",
    phase: "THE FINALE · 24HR BUILD",
    title: "THE LAST STAND",
    body: "One night, no retreat. Shortlisted teams build without rest until the axe falls silent.",
  },
  {
    id: "results",
    tag: "DAY 17",
    phase: "RESULTS & AWARDS",
    title: "THE VICTOR'S THRONE",
    body: "The blade is judged. Winners are named and the strongest builds take the throne.",
  },
];

// Axe path anchors across the whole section, from t=0 (top) to t=1 (bottom).
// Alternates x-side to visually "point at" whichever card is active,
// recedes in z for parallax depth, eases scale down toward the finale.
const AXE_ANCHORS = [
  { t: 0.0, pos: [-0.55, 0.15, 0], rotY: 0.5, rotZ: 0.12, scale: 1.15 },
  { t: 0.2, pos: [0.6, 0.05, -0.4], rotY: 1.6, rotZ: -0.1, scale: 1.05 },
  { t: 0.4, pos: [-0.6, -0.05, -0.8], rotY: 2.8, rotZ: 0.15, scale: 0.95 },
  { t: 0.6, pos: [0.6, -0.1, -1.2], rotY: 4.0, rotZ: -0.12, scale: 0.85 },
  { t: 0.8, pos: [-0.55, -0.15, -1.6], rotY: 5.3, rotZ: 0.1, scale: 0.75 },
  { t: 1.0, pos: [0.0, -0.2, -2.0], rotY: 6.4, rotZ: 0.0, scale: 0.68 },
];

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function sampleAxePath(u) {
  const anchors = AXE_ANCHORS;
  const clamped = THREE.MathUtils.clamp(u, 0, 1);
  let i = 0;
  while (i < anchors.length - 2 && clamped > anchors[i + 1].t) i++;
  const a = anchors[i];
  const b = anchors[i + 1];
  const span = b.t - a.t || 1;
  const local = (clamped - a.t) / span;
  return {
    pos: [
      lerp(a.pos[0], b.pos[0], local),
      lerp(a.pos[1], b.pos[1], local),
      lerp(a.pos[2], b.pos[2], local),
    ],
    rotY: lerp(a.rotY, b.rotY, local),
    rotZ: lerp(a.rotZ, b.rotZ, local),
    scale: lerp(a.scale, b.scale, local),
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useIsMobile(breakpoint = 820) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mq.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}

/** Overall 0..1 scroll progress through the whole timeline section. */
function useSectionProgress(containerRef) {
  const [overall, setOverall] = useState(0);
  useEffect(() => {
    let raf = null;
    const compute = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setOverall(total > 0 ? scrolled / total : 0);
      raf = null;
    };
    const onScroll = () => {
      if (raf == null) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [containerRef]);
  return overall;
}

/** Fires true once a node has scrolled ~25% into view, and stays true. */
function useRevealed(ref) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return revealed;
}

function useLeviathanAxe() {
  const { scene } = useGLTF(MODEL_PATH);
  return useMemo(() => {
    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const normalizeScale = 1.5 / maxDim;
    model.position.sub(center);

    const runeMeshes = [];
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (/rune/i.test(child.name)) {
          child.material = child.material.clone();
          child.material.emissiveIntensity = 0.25;
          runeMeshes.push(child);
        }
      }
    });
    return { model, normalizeScale, runeMeshes };
  }, [scene]);
}

function AxeModel({ progressRef, reducedMotion }) {
  const outer = useRef();
  const inner = useRef();
  const { model, normalizeScale, runeMeshes } = useLeviathanAxe();

  useFrame((state, delta) => {
    const g = outer.current;
    if (!g) return;
    const u = progressRef.current;
    const sample = sampleAxePath(u);

    const targetPos = new THREE.Vector3(...sample.pos);
    const targetScale = sample.scale * normalizeScale;
    const ease = reducedMotion ? 1 : 1 - Math.pow(0.002, delta);

    g.position.lerp(targetPos, ease);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, sample.rotY, ease);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, sample.rotZ, ease);
    const s = THREE.MathUtils.lerp(g.scale.x || targetScale, targetScale, ease);
    g.scale.setScalar(s);

    if (inner.current && !reducedMotion) {
      // gentle idle bob, on top of the scroll-driven path
      inner.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.03;
      inner.current.rotation.y += delta * 0.08;
    }

    // Runes fully ignite as the finale approaches.
    const runeStrength = THREE.MathUtils.clamp((u - 0.5) / 0.5, 0, 1);
    for (const mesh of runeMeshes) {
      mesh.material.emissiveIntensity = THREE.MathUtils.lerp(0.25, 3.2, runeStrength);
    }
  });

  return (
    <group ref={outer}>
      <group ref={inner}>
        <primitive object={model} />
      </group>
    </group>
  );
}

function AxeScene({ progressRef, reducedMotion, isMobile }) {
  return (
    <Canvas
      dpr={isMobile ? 1 : [1, 1.8]}
      camera={{ position: [0, 0, 4.4], fov: isMobile ? 42 : 32 }}
      gl={{ alpha: true, antialias: true }}
      style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 2]} intensity={1.2} color="#eaf7ff" />
      <pointLight position={[-2.5, -0.5, 2]} intensity={2.6} color="#ff8a2b" distance={9} />
      <pointLight position={[2.5, -0.5, 2]} intensity={2.6} color="#ff8a2b" distance={9} />
      <pointLight position={[0, 1.5, -1]} intensity={2} color="#8fe9ff" distance={9} />
      <Suspense fallback={null}>
        <AxeModel progressRef={progressRef} reducedMotion={reducedMotion} />
      </Suspense>
    </Canvas>
  );
}

function TimelineItem({ item, index }) {
  const ref = useRef(null);
  const revealed = useRevealed(ref);
  const side = index % 2 === 0 ? "left" : "right";

  return (
    <div ref={ref} className={`tl-item tl-${side} ${revealed ? "is-revealed" : ""}`}>
      <div className="tl-marker">
        <span className="tl-marker-index">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="tl-card">
        <div className="tl-tag">{item.tag}</div>
        <div className="tl-phase">{item.phase}</div>
        <h3 className="tl-title">{item.title}</h3>
        <p className="tl-body">{item.body}</p>
      </div>
    </div>
  );
}

export default function DeviathonTimeline() {
  const containerRef = useRef(null);
  const overall = useSectionProgress(containerRef);
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = useIsMobile();

  const progressRef = useRef(overall);
  useEffect(() => {
    progressRef.current = overall;
  }, [overall]);

  return (
    <section ref={containerRef} className="dev-timeline">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;900&family=EB+Garamond:ital@0;1&display=swap');
        .dev-timeline {
          position: relative;
          background: #0b0d0f;
          font-family: 'Cinzel', Georgia, serif;
          color: #dceef2;
          padding: 14vh 6vw 20vh;
          overflow: hidden;
        }
        .dev-timeline * { box-sizing: border-box; }
        .dev-timeline .stone-bg {
          position: absolute; inset: 0; z-index: 0;
          background:
            radial-gradient(ellipse at 20% 10%, rgba(255,140,60,0.07), transparent 40%),
            radial-gradient(ellipse at 80% 20%, rgba(143,233,255,0.06), transparent 40%),
            radial-gradient(circle at 50% 40%, #14181a 0%, #0b0d0f 70%);
        }
        .dev-axe-stage {
          position: sticky;
          top: 0;
          height: 100vh;
          margin-bottom: -100vh;
          z-index: 1;
          pointer-events: none;
        }
        .dev-axe-stage > div {
          position: absolute;
          inset: 0;
        }
        .tl-header { position: relative; z-index: 2; text-align: center; margin-bottom: 12vh; }
        .tl-eyebrow { letter-spacing: 0.35em; font-size: 0.7rem; color: #6fa9b5; text-transform: uppercase; }
        .tl-h1 {
          font-weight: 900;
          font-size: clamp(1.8rem, 5vw, 3.2rem);
          margin: 0.3em 0 0;
          background: linear-gradient(180deg, #f4fbfc 0%, #9fdcec 60%, #4c92a3 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .tl-track { position: relative; z-index: 2; max-width: 980px; margin: 0 auto; }
        .tl-spine-track, .tl-spine-fill {
          position: absolute;
          top: 0; bottom: 0;
          left: 50%;
          width: 2px;
          transform: translateX(-50%);
        }
        .tl-spine-track { background: rgba(127, 224, 242, 0.15); }
        .tl-spine-fill {
          background: linear-gradient(180deg, #8fe9ff, #4c92a3);
          box-shadow: 0 0 12px rgba(143,233,255,0.6);
          will-change: height;
        }
        .tl-item {
          position: relative;
          width: 50%;
          padding-bottom: 12vh;
          opacity: 0;
          transform: translateY(30px);
          transition: opacity 0.7s ease, transform 0.7s ease;
        }
        .tl-item.is-revealed { opacity: 1; transform: translateY(0); }
        .tl-left { margin-right: auto; text-align: right; padding-right: 3.5rem; }
        .tl-right { margin-left: auto; text-align: left; padding-left: 3.5rem; }
        .tl-marker {
          position: absolute;
          top: 0.15rem;
          width: 2.6rem;
          height: 2.6rem;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(circle at 35% 30%, #14343c, #071216);
          border: 1.5px solid rgba(143,233,255,0.35);
          box-shadow: 0 0 0 rgba(143,233,255,0);
          transition: box-shadow 0.6s ease, border-color 0.6s ease, transform 0.6s ease;
        }
        .tl-left .tl-marker { right: -1.3rem; }
        .tl-right .tl-marker { left: -1.3rem; }
        .is-revealed .tl-marker {
          border-color: #8fe9ff;
          box-shadow: 0 0 18px 2px rgba(143,233,255,0.55);
          transform: scale(1.08);
        }
        .tl-marker-index { font-size: 0.7rem; color: #8fe9ff; letter-spacing: 0.05em; }
        .tl-tag { font-size: 0.7rem; letter-spacing: 0.25em; color: #ff9d4d; text-transform: uppercase; }
        .tl-phase { font-size: 0.72rem; letter-spacing: 0.18em; color: #6fa9b5; text-transform: uppercase; margin-top: 0.3em; }
        .tl-title {
          font-weight: 700;
          font-size: clamp(1.1rem, 2.4vw, 1.5rem);
          margin: 0.35em 0 0.4em;
          color: #eaf7ff;
        }
        .tl-body {
          font-family: 'EB Garamond', Georgia, serif;
          font-style: italic;
          font-size: clamp(0.9rem, 1.3vw, 1.02rem);
          color: #b9d6dc;
          line-height: 1.55;
          max-width: 34ch;
        }
        .tl-left .tl-body { margin-left: auto; }

        @media (max-width: 820px) {
          .dev-timeline { padding: 10vh 5vw 14vh; }
          .tl-track { max-width: 100%; }
          .tl-spine-track, .tl-spine-fill { left: 1.1rem; transform: none; }
          .tl-item, .tl-left, .tl-right {
            width: 100%;
            margin-left: 0; margin-right: 0;
            text-align: left;
            padding-left: 3.2rem;
            padding-right: 0;
          }
          .tl-left .tl-marker, .tl-right .tl-marker { left: -0.1rem; right: auto; }
          .tl-left .tl-body { margin-left: 0; }
          .tl-marker { width: 2.2rem; height: 2.2rem; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tl-item { transition: opacity 0.3s ease; transform: none !important; }
        }
      `}</style>

      <div className="stone-bg" />

      {/* Axe rendered once, pinned to the viewport as the section scrolls past. */}
      <div className="dev-axe-stage">
        <div>
          <AxeScene progressRef={progressRef} reducedMotion={reducedMotion} isMobile={isMobile} />
        </div>
      </div>

      <div className="tl-header">
        <div className="tl-eyebrow">DEVIATHON · THE PATH TO GLORY</div>
        <h2 className="tl-h1">EVENT TIMELINE</h2>
      </div>

      <div className="tl-track">
        <div className="tl-spine-track" />
        <div className="tl-spine-fill" style={{ height: `${overall * 100}%` }} />
        {TIMELINE.map((item, i) => (
          <TimelineItem key={item.id} item={item} index={i} />
        ))}
      </div>
    </section>
  );
}

useGLTF.preload(MODEL_PATH);
