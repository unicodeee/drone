'use client';

import { useEffect, useRef, useState } from 'react';

interface TelemetryState {
  battery: number;
  wind: number;
  alt: number;
  stab: number;
  gps: number;
  temp: number;
  risk: number;
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
  startTime: Date.now(),
  totalEvents: 0,
};

function computeRisk(s: TelemetryState): number {
  let r = 0;
  if (s.battery < 8) r += 0.5;
  else if (s.battery < 20) r += 0.28;
  if (s.wind > 24) r += 0.38;
  else if (s.wind > 16) r += 0.22;
  if (s.stab < 0.62) r += 0.35;
  else if (s.stab < 0.82) r += 0.18;
  if (s.gps < 0.25) r += 0.28;
  if (s.temp > 52) r += 0.15;
  return Math.min(1, Math.max(0, r));
}

export default function HomePage() {
  const [state, setState] = useState<TelemetryState>(initialState);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flightCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  const inject = (type: 'wind' | 'bird' | 'battery' | 'gps' | 'turbulence' | 'engine' | 'reset') => {
    setState((prev) => {
      if (type === 'reset') {
        addLog('ok', 'ok', 'System RESET — all parameters restored to nominal baseline');
        return { ...initialState, startTime: prev.startTime };
      }

      let s = { ...prev };
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
      if (flightCanvasRef.current) {
        const el = flightCanvasRef.current;
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

  // Simple animation loop stub – you can paste
  // your full drawMain / flightPath logic here later.
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#040810');
      grad.addColorStop(1, '#0c1520');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'rgba(0,255,180,0.8)';
      ctx.font = '11px IBM Plex Mono, monospace';
      ctx.fillText(
        `RISK ${state.risk.toFixed(2)}  ALT ${Math.round(
          state.alt,
        )}m  WIND ${state.wind.toFixed(1)}m/s`,
        16,
        canvas.height - 20,
      );

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [state.risk, state.alt, state.wind]);

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

  const uptimeSeconds = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = String(Math.floor(uptimeSeconds / 60)).padStart(2, '0');
  const seconds = String(uptimeSeconds % 60).padStart(2, '0');

  const riskLabel = state.risk > 0.78 ? 'CRITICAL' : state.risk > 0.38 ? 'WARNING' : 'NOMINAL';

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

        <div className="triggers-section">
          <div className="triggers-label">INJECT DISTURBANCE</div>
          <div className="trigger-grid">
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('wind')}
            >
              <span className="t-name">⟳ Wind Spike</span>
              <span className="t-effect">→ 26 m/s gust</span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('bird')}
            >
              <span className="t-name">✕ Bird Strike</span>
              <span className="t-effect">→ stab drop</span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('battery')}
            >
              <span className="t-name">⚡ Batt Drop</span>
              <span className="t-effect">→ critical 8%</span>
            </button>
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('gps')}
            >
              <span className="t-name">⊘ GPS Jam</span>
              <span className="t-effect">→ signal loss</span>
            </button>
            <button
              type="button"
              className="trigger-btn"
              onClick={() => inject('turbulence')}
            >
              <span className="t-name">≈ Turbulence</span>
              <span className="t-effect">→ multi-axis</span>
            </button>
            <button
              type="button"
              className="trigger-btn danger"
              onClick={() => inject('engine')}
            >
              <span className="t-name">⚠ Engine Vibe</span>
              <span className="t-effect">→ mech fault</span>
            </button>
          </div>
          <button
            type="button"
            className="trigger-reset"
            onClick={() => inject('reset')}
          >
            ↺ RESET ALL SYSTEMS
          </button>
        </div>
        <div className="map-section">
          <div className="panel-header" style={{ padding: '6px 14px' }}>
            <span className="accent">◎</span> FLIGHT PATH
          </div>
          <div className="map-canvas-wrap">
            <canvas ref={flightCanvasRef} />
          </div>
        </div>
      </div>

      {/* CENTER PANEL – main sim canvas + log stub */}
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
        </div>
      </div>
    </div>
  );
}
