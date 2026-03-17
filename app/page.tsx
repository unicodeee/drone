'use client';

import { useEffect, useRef, useState } from 'react';

type ScenarioType = 'wind' | 'bird' | 'battery' | 'gps' | 'turbulence' | 'engine' | null;

interface TelemetryState {
  battery: number;
  wind: number;
  alt: number;
  stab: number;
  gps: number;
  temp: number;
  risk: number;
  scenario: ScenarioType;
  startTime: number;
  totalEvents: number;
}

type LogLevel = 'ok' | 'warn' | 'crit' | 'cmd';

interface LogEntry {
  id: number;
  level: LogLevel;
  badge: 'ok' | 'warn' | 'crit' | 'cmd';
  message: string;
  time: string;
}

const initialState: TelemetryState = {
  battery: 78,
  wind: 6,
  alt: 95,
  stab: 0.96,
  gps: 0.95,
  temp: 32,
  risk: 0.08,
  scenario: null,
  startTime: Date.now(),
  totalEvents: 0,
};

interface TelemetryIssue {
  key: string;
  val: string;
  threshold: string;
  delta: string;
}

function computeRiskAndIssues(s: TelemetryState): { risk: number; issues: TelemetryIssue[] } {
  let r = 0;
  const issues: TelemetryIssue[] = [];
  if (s.battery < 8) {
    r += 0.5;
    issues.push({
      key: 'BATTERY_CRITICAL',
      val: s.battery.toFixed(0) + '%',
      threshold: '10%',
      delta: '+' + (10 - s.battery).toFixed(1) + '%',
    });
  } else if (s.battery < 20) {
    r += 0.28;
    issues.push({
      key: 'BATTERY_LOW',
      val: s.battery.toFixed(0) + '%',
      threshold: '20%',
      delta: '+' + (20 - s.battery).toFixed(1) + '%',
    });
  }
  if (s.wind > 24) {
    r += 0.38;
    issues.push({
      key: 'WIND_CRITICAL',
      val: s.wind.toFixed(1) + 'm/s',
      threshold: '24m/s',
      delta: '+' + (s.wind - 24).toFixed(1),
    });
  } else if (s.wind > 16) {
    r += 0.22;
    issues.push({
      key: 'HIGH_WIND',
      val: s.wind.toFixed(1) + 'm/s',
      threshold: '16m/s',
      delta: '+' + (s.wind - 16).toFixed(1),
    });
  }
  if (s.stab < 0.62) {
    r += 0.35;
    issues.push({
      key: 'WING_INSTABILITY',
      val: s.stab.toFixed(2),
      threshold: '0.75',
      delta: (s.stab - 0.75).toFixed(2),
    });
  } else if (s.stab < 0.82) {
    r += 0.18;
    issues.push({
      key: 'REDUCED_STABILITY',
      val: s.stab.toFixed(2),
      threshold: '0.82',
      delta: (s.stab - 0.82).toFixed(2),
    });
  }
  if (s.gps < 0.25) {
    r += 0.28;
    issues.push({
      key: 'GPS_SIGNAL_LOSS',
      val: s.gps.toFixed(2),
      threshold: '0.40',
      delta: (s.gps - 0.4).toFixed(2),
    });
  }
  if (s.temp > 52) {
    r += 0.15;
    issues.push({
      key: 'THERMAL_WARNING',
      val: s.temp.toFixed(0) + '°C',
      threshold: '50°C',
      delta: '+' + (s.temp - 50).toFixed(0) + '°',
    });
  }
  const risk = Math.min(1, Math.max(0, r));
  return { risk, issues };
}

function computeRisk(s: TelemetryState): number {
  return computeRiskAndIssues(s).risk;
}

interface AgentCardData {
  severity: 'warn' | 'crit';
  title: string;
  body: string;
  plan: { text: string; pri: string }[];
  command: string;
  issues: TelemetryIssue[];
  risk: number;
}

function getAgentCard(s: TelemetryState, risk: number, issues: TelemetryIssue[]): AgentCardData | null {
  if (issues.length === 0 || risk <= 0.38) return null;
  const primary = issues[0];
  if (risk > 0.78) {
    if (primary.key.includes('BATTERY')) {
      return {
        severity: 'crit',
        title: 'CRITICAL: Power Failure Imminent',
        body: `Battery at ${primary.val} — estimated ${Math.max(1, Math.round(s.battery / 0.8))} seconds of flight remaining. Immediate RETURN_TO_HOME required to prevent total power loss.`,
        plan: [
          { text: 'Execute RETURN_TO_HOME command immediately', pri: 'high' },
          { text: 'Reduce payload throttle by 30% to extend range', pri: 'high' },
          { text: 'Alert ground crew for emergency retrieval', pri: 'med' },
          { text: 'Log incident for post-flight battery audit', pri: 'low' },
        ],
        command: 'CMD: RETURN_TO_HOME — priority=CRITICAL reason=BATTERY_CRITICAL',
        issues,
        risk,
      };
    }
    if (primary.key.includes('WIND')) {
      return {
        severity: 'crit',
        title: 'CRITICAL: Wind Exceeds Safety Threshold',
        body: `Wind speed ${primary.val} exceeds structural limit. Sustained exposure risks attitude loss and rotor stall. Initiating autonomous descent.`,
        plan: [
          { text: 'Descend to <40m altitude — wind speed lower at ground level', pri: 'high' },
          { text: 'Orient nose into wind to reduce drag coefficient', pri: 'high' },
          { text: 'Reduce forward velocity to 0 m/s — hover stabilization', pri: 'med' },
          { text: 'Monitor for gust spikes >2 m/s variance', pri: 'low' },
        ],
        command: 'CMD: EMERGENCY_DESCENT alt=40m mode=HEADWIND_ORIENT',
        issues,
        risk,
      };
    }
    return {
      severity: 'crit',
      title: 'CRITICAL: Structural Integrity Compromised',
      body: `Wing stability at ${primary.val} — possible bird strike or rotor blade damage. Flight envelope severely reduced. STABILIZE and land immediately.`,
      plan: [
        { text: 'Engage autopilot stabilization routine', pri: 'high' },
        { text: 'Reduce airspeed to minimum controllable', pri: 'high' },
        { text: 'Find nearest clear landing zone within 200m', pri: 'med' },
        { text: 'Initiate slow controlled descent — 1m/s rate', pri: 'med' },
      ],
      command: 'CMD: EMERGENCY_LAND mode=SLOW_DESCENT vspeed=1.0',
      issues,
      risk,
    };
  }
  return {
    severity: 'warn',
    title: 'WARNING: ' + primary.key.replace(/_/g, ' '),
    body: `Detected ${primary.key.replace(/_/g, ' ')} — current value ${primary.val} vs threshold ${primary.threshold}. Deviation: ${primary.delta}. Risk elevation without intervention.`,
    plan: [
      { text: 'Reduce operational envelope — lower speed and altitude', pri: 'med' },
      { text: `Monitor ${primary.key} trend over next 30 seconds`, pri: 'med' },
      { text: 'Prepare emergency procedure if condition worsens', pri: 'low' },
    ],
    command: 'CMD: ADVISORY reduce_envelope=true monitor=' + primary.key,
    issues,
    risk,
  };
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  spd: number;
}
interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<TelemetryState>(initialState);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedAgentCard, setSelectedAgentCard] = useState<AgentCardData | null>(null);
  type MetricKey = 'battery' | 'wind' | 'alt' | 'stab' | 'gps' | 'temp';
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const simRef = useRef({
    x: 0,
    y: 0,
    heading: 0,
    tick: 0,
    worldScroll: 0,
    clouds: [] as Cloud[],
    birds: [] as Bird[],
    particles: [] as Particle[],
    cloudsInitialized: false,
  });

  const addLog = (level: LogLevel, badge: LogEntry['badge'], message: string) => {
    const now = new Date();
    const t = `${String(now.getMinutes()).padStart(2, '0')}:${String(
      now.getSeconds(),
    ).padStart(2, '0')}.${String(now.getMilliseconds()).slice(0, 1)}`;
    setLogs((prev) => [
      {
        id: Date.now() + Math.random(),
        level,
        badge,
        message,
        time: t,
      },
      ...prev,
    ]);
    setState((prev) => ({ ...prev, totalEvents: prev.totalEvents + 1 }));
  };
  const addLogRef = useRef(addLog);
  addLogRef.current = addLog;

  const inject = (type: 'wind' | 'bird' | 'battery' | 'gps' | 'turbulence' | 'engine' | 'reset') => {
    setState((prev) => {
      if (type === 'reset') {
        setLogs([]);
        return { ...initialState, startTime: prev.startTime };
      }

      let s: TelemetryState = { ...prev, scenario: type };
      if (type === 'wind') {
        s.wind = 26 + Math.random() * 3;
        addLog(
          'warn',
          'warn',
          `DISTURBANCE — Wind spike detected: ${s.wind.toFixed(
            1,
          )} m/s. Exceeds CRITICAL threshold of 24 m/s`,
        );
      } else if (type === 'bird') {
        s.stab = 0.58 + Math.random() * 0.06;
        addLog(
          'crit',
          'crit',
          `DISTURBANCE — Wing stability CRITICAL drop to ${s.stab.toFixed(
            2,
          )}. Possible bird strike or mechanical fault`,
        );
      } else if (type === 'battery') {
        s.battery = 7 + Math.random() * 2;
        addLog(
          'crit',
          'crit',
          `DISTURBANCE — Battery CRITICAL at ${s.battery.toFixed(
            0,
          )}%. Failure imminent — immediate action required`,
        );
      } else if (type === 'gps') {
        s.gps = 0.08 + Math.random() * 0.1;
        addLog(
          'warn',
          'warn',
          `DISTURBANCE — GPS signal loss. Current strength: ${s.gps.toFixed(
            2,
          )}. Navigation accuracy reduced`,
        );
      } else if (type === 'turbulence') {
        s.stab -= 0.12;
        s.wind += 8;
        s.alt += 15;
        addLog(
          'warn',
          'warn',
          'DISTURBANCE — Turbulence event: multi-axis disturbance (wind +8 m/s, stability -0.12, altitude variance ±15m)',
        );
      } else if (type === 'engine') {
        s.stab -= 0.08;
        s.temp += 18;
        addLog(
          'crit',
          'crit',
          `DISTURBANCE — Engine vibration anomaly. Temperature spike to ${s.temp.toFixed(
            0,
          )}°C. Mechanical fault suspected`,
        );
      }
      s.risk = computeRisk(s);
      return s;
    });
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Live agent decision log: add a new entry every few seconds based on current telemetry
  useEffect(() => {
    if (!mounted) return;
    const id = setInterval(() => {
      const S = stateRef.current;
      const { risk, issues } = computeRiskAndIssues(S);
      const log = addLogRef.current;
      if (risk > 0.78) {
        log(
          'crit',
          'crit',
          `Agent: CRITICAL — Risk ${risk.toFixed(2)}. ${issues.map((i) => i.key).join(', ')}. Issuing emergency recommendation.`,
        );
      } else if (risk > 0.38) {
        log(
          'warn',
          'warn',
          `Agent: WARNING — Risk ${risk.toFixed(2)}. ${issues[0]?.key ?? 'Elevated'} — ${issues[0]?.val ?? 'monitoring'}. Advisory active.`,
        );
      } else {
        log(
          'ok',
          'ok',
          `Agent: Nominal. Risk ${risk.toFixed(2)} · Batt ${Math.round(S.battery)}% · Wind ${S.wind.toFixed(1)} m/s · Alt ${Math.round(S.alt)} m.`,
        );
      }
    }, 2500);
    return () => clearInterval(id);
  }, [mounted]);

  // Resize canvases to fill containers
  useEffect(() => {
    function resize() {
      if (mainCanvasRef.current) {
        const el = mainCanvasRef.current;
        const parent = el.parentElement;
        if (!parent) return;
        el.width = parent.clientWidth;
        el.height = parent.clientHeight;
      }
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Live flight simulation: full scene (sky, ground, clouds, wind, drone, HUD)
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frameId: number;
    const sim = simRef.current;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const S = stateRef.current;

      if (w <= 0 || h <= 0) {
        frameId = requestAnimationFrame(render);
        return;
      }

      if (!sim.cloudsInitialized || sim.clouds.length === 0) {
        sim.cloudsInitialized = true;
        sim.clouds = Array.from({ length: 8 }, () => ({
          x: Math.random() * (w + 400),
          y: 40 + Math.random() * 120,
          w: 60 + Math.random() * 80,
          spd: 0.2 + Math.random() * 0.3,
        }));
      }

      sim.tick += 1;
      const scrollSpeed = 0.9;
      sim.worldScroll += scrollSpeed;

      // Drone fixed at center (flies right-to-left = world scrolls right)
      sim.x = w / 2;
      sim.y =
        h * 0.45 -
        (S.alt - 50) * 1.2 +
        (S.stab < 0.75 ? Math.sin(sim.tick * 0.3) * 18 : 0);
      sim.heading = -0.05;

      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
      sky.addColorStop(0, '#040810');
      sky.addColorStop(0.5, '#080f1a');
      sky.addColorStop(1, '#0c1520');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * 0.65);

      // Ground
      const grd = ctx.createLinearGradient(0, h * 0.65, 0, h);
      grd.addColorStop(0, '#0a1505');
      grd.addColorStop(1, '#060d04');
      ctx.fillStyle = grd;
      ctx.fillRect(0, h * 0.65, w, h * 0.35);

      // Horizon
      ctx.strokeStyle = 'rgba(0,255,180,0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.65);
      ctx.lineTo(w, h * 0.65);
      ctx.stroke();
      ctx.setLineDash([]);

      // Grid sky (scrolls with world, right-to-left)
      const gridStep = 40;
      const scrollOff = sim.worldScroll % gridStep;
      ctx.strokeStyle = 'rgba(0,255,180,0.04)';
      ctx.lineWidth = 0.5;
      for (let i = -1; i <= w / gridStep + 2; i++) {
        const gx = i * gridStep - scrollOff;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h * 0.65);
        ctx.stroke();
      }
      for (let gy = 0; gy < h * 0.65; gy += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Altitude indicator
      const altPct = Math.min(1, S.alt / 150);
      const altY = h * 0.65 - altPct * (h * 0.6);
      ctx.strokeStyle = 'rgba(77,184,255,0.3)';
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, altY);
      ctx.lineTo(w, altY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(77,184,255,0.6)';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillText(`${Math.round(S.alt)}m`, 4, altY - 3);

      // Clouds (world space: move left with worldScroll, wrap when off left)
      sim.clouds.forEach((cl) => {
        let screenX = cl.x - sim.worldScroll;
        if (screenX < -cl.w - 50) {
          cl.x += w + 2 * cl.w + 100;
          screenX = cl.x - sim.worldScroll;
        }
        const alpha = S.wind > 18 ? 0.12 : 0.07;
        ctx.fillStyle = `rgba(100,180,255,${alpha})`;
        ctx.beginPath();
        ctx.ellipse(screenX, cl.y, cl.w / 2, cl.w / 5, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Wind lines (scroll with world)
      if (S.wind > 10) {
        const wIntensity = (S.wind - 10) / 20;
        for (let i = 0; i < 5; i++) {
          const wy = 80 + i * 60;
          const len = 30 + wIntensity * 60;
          const base = sim.tick * S.wind * 0.3 + i * 120 - sim.worldScroll;
          const offset = ((base % (w + 100)) + (w + 100)) % (w + 100) - 50;
          ctx.strokeStyle = `rgba(77,184,255,${0.1 + wIntensity * 0.2})`;
          ctx.lineWidth = 0.8;
          ctx.setLineDash([len, 20 + Math.random() * 40]);
          ctx.beginPath();
          ctx.moveTo(offset, wy);
          ctx.lineTo(offset + len, wy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Birds (bird strike scenario)
      if (S.scenario === 'bird' && sim.birds.length === 0) {
        sim.birds = Array.from({ length: 4 }, () => ({
          x: Math.random() * w,
          y: 80 + Math.random() * 100,
          vx: -1.5 - Math.random(),
          vy: 0.3 - Math.random() * 0.6,
        }));
      }
      if (S.scenario !== 'bird') sim.birds = [];
      sim.birds.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        if (b.x < -20) b.x = w + 20;
        ctx.strokeStyle = 'rgba(255,180,100,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(b.x - 6, b.y + 3);
        ctx.quadraticCurveTo(b.x, b.y - 4, b.x + 6, b.y + 3);
        ctx.stroke();
      });

      // Particles (turbulence / engine)
      if (S.scenario === 'turbulence' || S.scenario === 'engine') {
        for (let i = 0; i < 3; i++) {
          sim.particles.push({
            x: sim.x,
            y: sim.y,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            life: 40,
            color: 'rgba(255,183,0,',
          });
        }
      }
      sim.particles = sim.particles.filter((p) => p.life > 0);
      sim.particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        ctx.fillStyle = p.color + (p.life / 40) * 0.6 + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Thrust rings (rotors)
      const rotorR = 14;
      const thrustColor =
        S.risk > 0.78
          ? 'rgba(255,68,68,0.4)'
          : S.risk > 0.38
            ? 'rgba(255,183,0,0.3)'
            : 'rgba(0,255,180,0.3)';
      [
        [-20, -10],
        [20, -10],
        [-20, 10],
        [20, 10],
      ].forEach(([ox, oy]) => {
        const rx = sim.x + ox;
        const ry = sim.y + oy;
        ctx.strokeStyle = thrustColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rx, ry, rotorR, 0, Math.PI * 2);
        ctx.stroke();
        const angle = sim.tick * 0.35;
        ctx.strokeStyle = 'rgba(180,220,255,0.5)';
        ctx.lineWidth = 1.5;
        for (let r = 0; r < 2; r++) {
          const a = angle + r * Math.PI;
          ctx.beginPath();
          ctx.moveTo(rx + Math.cos(a) * rotorR * 0.8, ry + Math.sin(a) * rotorR * 0.8);
          ctx.lineTo(rx - Math.cos(a) * rotorR * 0.8, ry - Math.sin(a) * rotorR * 0.8);
          ctx.stroke();
        }
      });

      // Drone body
      ctx.save();
      ctx.translate(sim.x, sim.y);
      ctx.rotate(sim.heading * 0.2);
      const bodyColor =
        S.risk > 0.78
          ? 'rgba(255,68,68,0.9)'
          : S.risk > 0.38
            ? 'rgba(255,183,0,0.9)'
            : 'rgba(0,255,180,0.9)';
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(0, -8);
      ctx.lineTo(14, 0);
      ctx.lineTo(0, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,200,255,0.4)';
      ctx.lineWidth = 1.5;
      [
        [-20, -10],
        [20, -10],
        [-20, 10],
        [20, 10],
      ].forEach(([ox, oy]) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ox, oy);
        ctx.stroke();
      });
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      glow.addColorStop(
        0,
        S.risk > 0.78
          ? 'rgba(255,68,68,0.15)'
          : S.risk > 0.38
            ? 'rgba(255,183,0,0.12)'
            : 'rgba(0,255,180,0.1)',
      );
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // HUD text
      ctx.fillStyle = 'rgba(0,255,180,0.8)';
      ctx.font = '11px IBM Plex Mono, monospace';
      ctx.fillText(
        `RISK: ${S.risk.toFixed(3)}  ALT: ${Math.round(S.alt)}m  WIND: ${S.wind.toFixed(1)}m/s`,
        10,
        h - 10,
      );

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Simple ticking of uptime + recompute risk (no physics yet)
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => ({
        ...prev,
        risk: computeRisk(prev),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const uptimeSeconds = mounted
    ? Math.floor((Date.now() - state.startTime) / 1000)
    : 0;
  const minutes = String(Math.floor(uptimeSeconds / 60)).padStart(2, '0');
  const seconds = String(uptimeSeconds % 60).padStart(2, '0');

  const riskLabel = state.risk > 0.78 ? 'CRITICAL' : state.risk > 0.38 ? 'WARNING' : 'NOMINAL';
  const riskStatusText = state.risk > 0.78 ? 'CRITICAL' : state.risk > 0.38 ? 'WARNING' : 'SAFE';
  const riskColor =
    state.risk > 0.78 ? 'var(--red)' : state.risk > 0.38 ? 'var(--amber)' : 'var(--green)';
  const confPct = Math.round((1 - state.risk) * 100);
  const riskPointerLeft = Math.min(92, Math.max(4, state.risk * 92 + 4));

  return (
    <div className="layout">
      {/* HEADER */}
      <header className="header">
        <span className="header-logo">AFSM v2.1</span>
        <span className="header-sub">AUTONOMOUS FLIGHT SAFETY MONITOR</span>
        <div className="header-spacer" />
        <div className="header-stat">
          <span className="pulse-dot" />
          <span>STATUS</span>
          <span className="val">{riskLabel}</span>
        </div>
        <div className="header-stat">
          <span>DRONE</span>
          <span className="val">DRONE_001</span>
        </div>
        <div className="header-stat">
          <span>UPTIME</span>
          <span className="val">
            {minutes}:{seconds}
          </span>
        </div>
        <div className="header-stat">
          <span>EVENTS</span>
          <span className="val">{state.totalEvents}</span>
        </div>
      </header>

      {/* LEFT PANEL – telemetry / triggers / map (static shell for now) */}
      <div className="left-panel">
        <div className="panel-header">
          <span className="accent">▣</span> TELEMETRY · LIVE
        </div>
        <div className="metrics-section">
          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('battery')}
          >
            <div className="metric-label">Battery</div>
            <div className="metric-value">
              {Math.round(state.battery)}
              <span className="metric-unit">%</span>
            </div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${state.battery}%`,
                  background: state.battery < 15 ? 'var(--red)' : state.battery < 30 ? 'var(--amber)' : 'var(--green)',
                }}
              />
            </div>
            <div className="metric-trend">
              {state.battery < 15 ? '⚠ CRITICAL LOW' : state.battery < 30 ? '▼ low' : '▼ draining'}
            </div>
          </button>

          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('wind')}
          >
            <div className="metric-label">Wind</div>
            <div className="metric-value">
              {state.wind.toFixed(1)}
              <span className="metric-unit">m/s</span>
            </div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${(state.wind / 30) * 100}%`,
                  background: state.wind > 24 ? 'var(--red)' : state.wind > 16 ? 'var(--amber)' : 'var(--green)',
                }}
              />
            </div>
            <div className="metric-trend">
              {state.wind > 24 ? '▲ EXCEEDED' : state.wind > 16 ? '▲ HIGH' : 'stable'}
            </div>
          </button>

          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('alt')}
          >
            <div className="metric-label">Altitude</div>
            <div className="metric-value">
              {Math.round(state.alt)}
              <span className="metric-unit">m</span>
            </div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${(state.alt / 150) * 100}%`,
                  background: 'var(--blue)',
                }}
              />
            </div>
            <div className="metric-trend">{state.alt > 120 ? '▲ HIGH' : 'holding'}</div>
          </button>

          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('stab')}
          >
            <div className="metric-label">Wing Stab</div>
            <div className="metric-value">{state.stab.toFixed(2)}</div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${state.stab * 100}%`,
                  background: state.stab < 0.62 ? 'var(--red)' : state.stab < 0.82 ? 'var(--amber)' : 'var(--green)',
                }}
              />
            </div>
            <div className="metric-trend">
              {state.stab < 0.62 ? '⚠ UNSTABLE' : state.stab < 0.82 ? '⚠ DEGRADED' : 'nominal'}
            </div>
          </button>

          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('gps')}
          >
            <div className="metric-label">GPS Sig</div>
            <div className="metric-value">{state.gps.toFixed(2)}</div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${state.gps * 100}%`,
                  background: state.gps < 0.25 ? 'var(--red)' : state.gps < 0.5 ? 'var(--amber)' : 'var(--green)',
                }}
              />
            </div>
            <div className="metric-trend">
              {state.gps < 0.25 ? '⊘ LOSS' : state.gps < 0.5 ? '⚠ WEAK' : 'strong'}
            </div>
          </button>

          <button
            type="button"
            className="metric-card"
            onClick={() => setSelectedMetric('temp')}
          >
            <div className="metric-label">Temp</div>
            <div className="metric-value">
              {Math.round(state.temp)}
              <span className="metric-unit">°C</span>
            </div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${(state.temp / 80) * 100}%`,
                  background: state.temp > 55 ? 'var(--red)' : state.temp > 45 ? 'var(--amber)' : 'var(--amber)',
                }}
              />
            </div>
            <div className="metric-trend">
              {state.temp > 55 ? '⚠ CRITICAL' : state.temp > 45 ? '⚠ HOT' : 'normal'}
            </div>
          </button>
        </div>

        <div className="risk-section">
          <div className="risk-row">
            <div
              className="risk-score-big"
              style={{ color: riskColor }}
            >
              {state.risk.toFixed(2)}
            </div>
            <div className="risk-label-col">
              <div
                className="risk-status"
                style={{ color: riskColor }}
              >
                {riskStatusText}
              </div>
              <div
                className={`mode-badge ${
                  state.risk > 0.78 ? 'mode-autonomous' : 'mode-advisory'
                }`}
              >
                <span className="pulse-dot" />
                <span className="mode-text">
                  {state.risk > 0.78 ? 'AUTONOMOUS MODE' : 'ADVISORY MODE'}
                </span>
              </div>
              <div className="risk-conf">
                CONF: <span className="conf-val">{confPct}%</span>
              </div>
            </div>
          </div>
          <div className="risk-bar-track">
            <div
              className="risk-pointer"
              style={{ left: `${riskPointerLeft}%` }}
            />
          </div>
        </div>

        <div className="triggers-section">
          <div className="triggers-label">INJECT DISTURBANCE</div>
          <div className="trigger-grid">
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('wind')}
            >
              <span className="trigger-icon" aria-hidden>⟳</span>
              <span className="trigger-text">
                <span className="t-name">Wind Spike</span>
                <span className="t-effect">→ 26 m/s gust</span>
              </span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('bird')}
            >
              <span className="trigger-icon" aria-hidden>✕</span>
              <span className="trigger-text">
                <span className="t-name">Bird Strike</span>
                <span className="t-effect">→ stab drop</span>
              </span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('battery')}
            >
              <span className="trigger-icon" aria-hidden>⚡</span>
              <span className="trigger-text">
                <span className="t-name">Batt Drop</span>
                <span className="t-effect">→ critical 8%</span>
              </span>
            </button>
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('gps')}
            >
              <span className="trigger-icon" aria-hidden>⊘</span>
              <span className="trigger-text">
                <span className="t-name">GPS Jam</span>
                <span className="t-effect">→ signal loss</span>
              </span>
            </button>
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('turbulence')}
            >
              <span className="trigger-icon" aria-hidden>≈</span>
              <span className="trigger-text">
                <span className="t-name">Turbulence</span>
                <span className="t-effect">→ multi-axis</span>
              </span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('engine')}
            >
              <span className="trigger-icon" aria-hidden>⚠</span>
              <span className="trigger-text">
                <span className="t-name">Engine Vibe</span>
                <span className="t-effect">→ mech fault</span>
              </span>
            </button>
          </div>
          <button
            type="button"
            className="trigger-reset"
            onClick={() => inject('reset')}
          >
            <span className="trigger-reset-icon" aria-hidden>↺</span>
            RESET ALL SYSTEMS
          </button>
        </div>
      </div>

      {/* CENTER PANEL – main sim canvas + log */}
      <div className="center-panel">
        <div className="panel-header">
          <span className="accent">◈</span> LIVE FLIGHT SIMULATION
        </div>
        <div className="flight-view">
          <canvas ref={mainCanvasRef} />
        </div>
        <div className="log-section">
          <div className="panel-header">
            <span className="accent">≡</span> AGENT DECISION LOG
            <span style={{ flex: 1 }} />
            <span
              style={{ fontSize: 8, color: 'var(--text-dim)' }}
            >
              {logs.length} entries
            </span>
          </div>
          <div className="log-body">
            {logs.slice(0, 60).map((log) => (
              <div
                key={log.id}
                className={`log-entry ${log.level}`}
              >
                <span className="log-time">{log.time}</span>
                <span className={`log-badge badge-${log.badge}`}>{log.badge.toUpperCase()}</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL – agent cards stub */}
      <div className="right-panel">
        <div className="panel-header">
          <span className="accent">◆</span> AI FLIGHT SAFETY AGENT
        </div>
        <div className="agent-section" id="agent-section">
          {(() => {
            const { issues } = computeRiskAndIssues(state);
            const card = getAgentCard(state, state.risk, issues);
            if (!card) {
              return (
                <div
                  style={{
                    padding: '20px 12px',
                    textAlign: 'center',
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    color: 'var(--text-dim)',
                  }}
                >
                  Agent monitoring...
                  <br />
                  <br />
                  <div className="pulse-dot" style={{ margin: '0 auto' }} />
                </div>
              );
            }
            return (
              <div
                className={`agent-card ${card.severity}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedAgentCard(card)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedAgentCard(card)}
              >
                <div className="agent-card-header">
                  <span className="agent-card-icon">
                    {card.severity === 'crit' ? '⚠' : '▲'}
                  </span>
                  <span className="agent-card-title">{card.title}</span>
                  <span
                    className={`agent-card-score ${
                      card.severity === 'crit'
                        ? 'score-crit'
                        : card.severity === 'warn'
                          ? 'score-warn'
                          : 'score-ok'
                    }`}
                  >
                    {card.risk.toFixed(2)}
                  </span>
                </div>
                <div className="agent-card-body">
                  {card.body}
                  <div className="evidence">
                    {card.issues.map((e, i) => (
                      <span key={e.key}>
                        {i > 0 && ' · '}
                        {e.key}: <span>{e.val}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="cmd-block">
                  <div className="cmd-label">DECISION</div>
                  {card.command}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Telemetry detail modal (when a metric card is clicked) */}
      {selectedMetric && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setSelectedMetric(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="telemetry-modal-title"
        >
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title" id="telemetry-modal-title">
                  {selectedMetric === 'battery' && 'Battery Level'}
                  {selectedMetric === 'wind' && 'Wind Speed'}
                  {selectedMetric === 'alt' && 'Altitude'}
                  {selectedMetric === 'stab' && 'Wing Stability'}
                  {selectedMetric === 'gps' && 'GPS Signal'}
                  {selectedMetric === 'temp' && 'Temperature'}
                </div>
                <div className="modal-sub">
                  Live telemetry analysis · {new Date().toLocaleTimeString()}
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedMetric(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <div className="modal-section-title">CURRENT READING</div>
                <div className="telemetry-value-large">
                  {selectedMetric === 'battery' && `${state.battery.toFixed(1)}%`}
                  {selectedMetric === 'wind' && `${state.wind.toFixed(1)} m/s`}
                  {selectedMetric === 'alt' && `${state.alt.toFixed(0)} m`}
                  {selectedMetric === 'stab' && state.stab.toFixed(3)}
                  {selectedMetric === 'gps' && state.gps.toFixed(3)}
                  {selectedMetric === 'temp' && `${state.temp.toFixed(0)}°C`}
                </div>
                <div className="modal-thresholds">
                  {selectedMetric === 'battery' && 'Thresholds: WARN<20% CRIT<10%'}
                  {selectedMetric === 'wind' && 'Thresholds: WARN>16 m/s CRIT>24 m/s'}
                  {selectedMetric === 'alt' && 'Thresholds: SAFE 50–120 m'}
                  {selectedMetric === 'stab' && 'Thresholds: WARN<0.82 CRIT<0.62'}
                  {selectedMetric === 'gps' && 'Thresholds: WARN<0.5 CRIT<0.25'}
                  {selectedMetric === 'temp' && 'Thresholds: WARN>45°C CRIT>55°C'}
                </div>
              </div>
              <div className="modal-section">
                <div className="modal-section-title">ANALYSIS</div>
                <div className="modal-text">
                  {selectedMetric === 'battery' &&
                    (state.battery < 20
                      ? `Battery at ${state.battery.toFixed(1)}%. Below warning threshold — return to base recommended.`
                      : `Battery at ${state.battery.toFixed(1)}%. Nominal — estimated ${Math.round(state.battery * 1.2)} min remaining.`)}
                  {selectedMetric === 'wind' &&
                    (state.wind > 16
                      ? `Wind speed ${state.wind.toFixed(1)} m/s. Above safe operational limit — altitude reduction recommended.`
                      : `Wind speed ${state.wind.toFixed(1)} m/s. Within safe operating envelope.`)}
                  {selectedMetric === 'alt' &&
                    (state.alt > 120
                      ? `Current altitude ${state.alt.toFixed(0)} m. Approaching regulatory ceiling.`
                      : state.alt < 50
                        ? `Current altitude ${state.alt.toFixed(0)} m. Low altitude — collision risk elevated.`
                        : `Current altitude ${state.alt.toFixed(0)} m. Optimal flight band.`)}
                  {selectedMetric === 'stab' &&
                    (state.stab < 0.82
                      ? `Wing stability index ${state.stab.toFixed(3)}. Degraded — possible mechanical or environmental cause.`
                      : `Wing stability index ${state.stab.toFixed(3)}. Nominal aerodynamic performance.`)}
                  {selectedMetric === 'gps' &&
                    (state.gps < 0.5
                      ? `GPS signal strength ${state.gps.toFixed(3)}. Reduced accuracy — position hold unreliable.`
                      : `GPS signal strength ${state.gps.toFixed(3)}. Strong signal — full navigation available.`)}
                  {selectedMetric === 'temp' &&
                    (state.temp > 45
                      ? `System temperature ${state.temp.toFixed(0)}°C. Elevated — thermal throttling may activate.`
                      : `System temperature ${state.temp.toFixed(0)}°C. Within operational thermal limits.`)}
                </div>
              </div>
              <div className="modal-section">
                <div className="modal-section-title">
                  RECENT HISTORY (LAST 20 READINGS)
                </div>
                <div className="modal-text modal-hint">
                  Click on telemetry cards to view real-time trends.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent detail modal (when a card is clicked) */}
      {selectedAgentCard && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setSelectedAgentCard(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title" id="modal-title">
                  {selectedAgentCard.title}
                </div>
                <div className="modal-sub">
                  Risk score: {selectedAgentCard.risk.toFixed(3)} ·{' '}
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedAgentCard(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <div className="modal-section-title">AGENT ANALYSIS</div>
                <div className="modal-text">{selectedAgentCard.body}</div>
              </div>
              <div className="modal-section">
                <div className="modal-section-title">EVIDENCE FROM TELEMETRY</div>
                {selectedAgentCard.issues.map((e) => {
                  const deltaNum = parseFloat(e.delta.replace(/[^0-9.-]/g, ''));
                  const isDeltaOk = e.delta.startsWith('-') || deltaNum <= 0;
                  return (
                    <div key={e.key} className="evidence-row">
                      <span className="ev-metric">{e.key}</span>
                      <span className="ev-val">{e.val}</span>
                      <span className="ev-threshold">thresh: {e.threshold}</span>
                      <span className={`ev-delta ${isDeltaOk ? 'ok' : ''}`}>
                        {e.delta}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="modal-section">
                <div className="modal-section-title">INTERVENTION PLAN</div>
                {selectedAgentCard.plan.map((p, i) => (
                  <div key={i} className="plan-step">
                    <span className="plan-num">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="plan-text">{p.text}</span>
                    <span className={`plan-priority pri-${p.pri}`}>
                      {p.pri.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="modal-section">
                <div className="modal-section-title">COMMAND DECISION</div>
                <div className="cmd-action-row">
                  <span className="cmd-icon">▶</span>
                  <span className="cmd-text">{selectedAgentCard.command}</span>
                  <button
                    type="button"
                    className="cmd-execute-btn"
                    onClick={() => {
                      addLog(
                        'cmd',
                        'cmd',
                        `Operator executed: ${selectedAgentCard.command}`,
                      );
                      addLog(
                        'ok',
                        'ok',
                        'Agent: Command acknowledged — monitoring effect on flight parameters',
                      );
                      setSelectedAgentCard(null);
                    }}
                  >
                    EXECUTE
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
