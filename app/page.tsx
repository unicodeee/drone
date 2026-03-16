'use client';

import { useEffect, useRef, useState } from 'react';

type ScenarioType = 'wind' | 'bird' | 'battery' | 'gps' | 'turbulence' | 'engine' | 'reset' | null;

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
    badge: 'ok' | 'warn' | 'crit' | 'cmd' | 'agent';
    message: string;
    time: string;
}

interface AgentCard {
    id: string;
    severity: 'ok' | 'warn' | 'crit';
    title: string;
    body: string;
    plan: { text: string; pri: 'high' | 'med' }[];
    command: string;
    issues: { key: string; val: string; threshold: string }[];
    risk: number;
    ts: number;
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

function computeRisk(s: TelemetryState): { risk: number; issues: any[] } {
    let r = 0;
    let issues = [];
    if (s.battery < 8) { r += 0.5; issues.push({ key: 'BATTERY_CRITICAL', val: s.battery.toFixed(0) + '%', threshold: '10%' }); }
    else if (s.battery < 20) { r += 0.28; issues.push({ key: 'BATTERY_LOW', val: s.battery.toFixed(0) + '%', threshold: '20%' }); }

    if (s.wind > 24) { r += 0.38; issues.push({ key: 'WIND_CRITICAL', val: s.wind.toFixed(1) + 'm/s', threshold: '24m/s' }); }
    else if (s.wind > 16) { r += 0.22; issues.push({ key: 'HIGH_WIND', val: s.wind.toFixed(1) + 'm/s', threshold: '16m/s' }); }

    if (s.stab < 0.62) { r += 0.35; issues.push({ key: 'WING_INSTABILITY', val: s.stab.toFixed(2), threshold: '0.75' }); }
    else if (s.stab < 0.82) { r += 0.18; issues.push({ key: 'REDUCED_STABILITY', val: s.stab.toFixed(2), threshold: '0.82' }); }

    if (s.gps < 0.25) { r += 0.28; issues.push({ key: 'GPS_SIGNAL_LOSS', val: s.gps.toFixed(2), threshold: '0.40' }); }

    if (s.temp > 52) { r += 0.15; issues.push({ key: 'THERMAL_WARNING', val: s.temp.toFixed(0) + '°C', threshold: '50°C' }); }

    return { risk: Math.min(1, Math.max(0, r)), issues };
}

// Simulated Entities
interface Cloud { x: number; y: number; w: number; spd: number; }
interface Bird { x: number; y: number; vx: number; vy: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }

export default function HomePage() {
    const [state, setState] = useState<TelemetryState>(initialState);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [agentCards, setAgentCards] = useState<AgentCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<AgentCard | null>(null);

    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const flightCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    const lastDecisionTimeRef = useRef(0);

    const simRef = useRef({
        x: 0, y: 0, heading: 0, tick: 0,
        clouds: [] as Cloud[],
        birds: [] as Bird[],
        particles: [] as Particle[],
        cloudsInitialized: false,
        flightPath: [] as { x: number; y: number }[]
    });

    const addLog = (level: LogLevel, badge: LogEntry['badge'], message: string) => {
        const now = new Date();
        const t = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).slice(0, 1)}`;
        setLogs((prev) => [{ id: Date.now() + Math.random(), level, badge, message, time: t }, ...prev.slice(0, 59)]);
        setState((prev) => ({ ...prev, totalEvents: prev.totalEvents + 1 }));
    };

    const requestNemotronDecision = async (trigger: string) => {
        const now = Date.now();
        if (now - lastDecisionTimeRef.current < 2500) return;
        lastDecisionTimeRef.current = now;

        addLog('cmd', 'agent', `Nemotron: Analyzing safety state (Trigger: ${trigger})`);

        try {
            const { issues } = computeRisk(stateRef.current);
            const response = await fetch('/api/decision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telemetry: {
                        battery: stateRef.current.battery,
                        wind: stateRef.current.wind,
                        alt: stateRef.current.alt,
                        stab: stateRef.current.stab,
                        gps: stateRef.current.gps,
                        temp: stateRef.current.temp,
                        risk: stateRef.current.risk
                    },
                    issues,
                    trigger
                })
            });

            if (!response.ok) throw new Error('API Error');
            const decision = await response.json();

            const rules = Array.isArray(decision.triggered_rules) ? decision.triggered_rules : [];

            const newCard: AgentCard = {
                id: Math.random().toString(36).substr(2, 9),
                severity: decision.safety_state === 'CRITICAL' ? 'crit' : decision.safety_state === 'WARNING' ? 'warn' : 'ok',
                title: decision.recommended_action.replace(/_/g, ' '),
                body: decision.reasoning_bullets.join('. '),
                plan: decision.reasoning_bullets.map((b: string) => ({ text: b, pri: decision.safety_state === 'CRITICAL' ? 'high' : 'med' })),
                command: decision.command,
                issues: rules.map((r: any) => ({ key: r.rule_id, val: String(r.value), threshold: String(r.threshold) })),
                risk: decision.risk_score,
                ts: Date.now()
            };

            if (newCard.severity !== 'ok') {
                setAgentCards(prev => [newCard, ...prev.slice(0, 19)]);
                addLog(newCard.severity === 'crit' ? 'crit' : 'warn', 'agent', `NEMOTRON DECISION: ${newCard.title} -> ${newCard.command}`);
            } else {
                addLog('ok', 'agent', 'NEMOTRON: System state NOMINAL. No intervention required.');
            }

        } catch (err) {
            addLog('warn', 'agent', 'NEMOTRON: Analysis failed. Reverting to local safety rules.');
        }
    };

    const inject = (type: ScenarioType) => {
        setState((prev) => {
            if (type === 'reset') {
                addLog('ok', 'ok', 'System RESET — restoring nominal flight parameters');
                setAgentCards([]);
                return { ...initialState, startTime: prev.startTime };
            }

            let s: TelemetryState = { ...prev, scenario: type };
            if (type === 'wind') {
                s.wind = 26 + Math.random() * 3;
                addLog('warn', 'warn', `DISTURBANCE: Gust detected (${s.wind.toFixed(1)} m/s). Tracking stabilizer load...`);
            } else if (type === 'bird') {
                s.stab = 0.58 + Math.random() * 0.06;
                addLog('crit', 'crit', `COLLISION: Wing stability drop (${s.stab.toFixed(2)}). Structural fault?`);
            } else if (type === 'battery') {
                s.battery = 7 + Math.random() * 2;
                addLog('crit', 'crit', `POWER: Voltage drop detected. Battery at ${s.battery.toFixed(0)}%.`);
            } else if (type === 'gps') {
                s.gps = 0.08 + Math.random() * 0.1;
                addLog('warn', 'warn', 'SIGNAL: GPS signal spoofing or obstruction detected.');
            } else if (type === 'turbulence') {
                s.stab -= 0.12; s.wind += 8; s.alt += 15;
                addLog('warn', 'warn', 'ENVIRONMENT: Severe turbulence encounter. Adjusting thrust gain.');
            } else if (type === 'engine') {
                s.stab -= 0.08; s.temp += 18;
                addLog('crit', 'crit', `THERMAL: Motor temp rising (${s.temp.toFixed(0)}°C). Abrasive vibration.`);
            }

            const { risk } = computeRisk(s);
            s.risk = risk;
            return s;
        });

        if (type !== 'reset' && type !== null) {
            requestNemotronDecision(`INJECT_${type.toUpperCase()}`);
        }
    };

    const executeCommand = (card: AgentCard) => {
        addLog('cmd', 'cmd', `EXECUTE: Operator has accepted ${card.title} [${card.command}]`);
        setSelectedCard(null);
        requestNemotronDecision('COMMAND_EXECUTED');
    };

    // Resize canvases
    useEffect(() => {
        const handleResize = () => {
            [mainCanvasRef, flightCanvasRef].forEach(ref => {
                if (ref.current && ref.current.parentElement) {
                    ref.current.width = ref.current.parentElement.clientWidth;
                    ref.current.height = ref.current.parentElement.clientHeight;
                }
            });
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Simulator Loop
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
            if (w <= 0 || h <= 0) { frameId = requestAnimationFrame(render); return; }

            if (!sim.cloudsInitialized) {
                sim.cloudsInitialized = true;
                sim.clouds = Array.from({ length: 8 }, () => ({ x: Math.random() * w, y: 40 + Math.random() * 120, w: 60 + Math.random() * 80, spd: 0.2 + Math.random() * 0.3 }));
            }

            sim.tick += 1;

            // SKY
            const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
            sky.addColorStop(0, '#040810'); sky.addColorStop(1, '#0c1520');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.65);

            // GROUND
            const grd = ctx.createLinearGradient(0, h * 0.65, 0, h);
            grd.addColorStop(0, '#0a1505'); grd.addColorStop(1, '#060d04');
            ctx.fillStyle = grd; ctx.fillRect(0, h * 0.65, w, h * 0.35);

            // Grid
            ctx.strokeStyle = 'rgba(0,255,180,0.04)'; ctx.lineWidth = 0.5;
            for (let gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h * 0.65); ctx.stroke(); }

            // Drone Position
            const targetX = w / 2 + Math.sin(sim.tick * 0.012) * 180 + (S.scenario === 'wind' ? Math.sin(sim.tick * 0.08) * 30 : 0);
            const targetY = h * 0.45 - (S.alt - 50) * 1.2 + Math.sin(sim.tick * 0.02) * 15 + (S.stab < 0.75 ? Math.sin(sim.tick * 0.3) * 18 : 0);
            sim.x += (targetX - sim.x) * 0.025;
            sim.y += (targetY - sim.y) * 0.02;

            // Rotor rings
            const thrustColor = S.risk > 0.78 ? 'rgba(255,68,68,0.4)' : S.risk > 0.38 ? 'rgba(255,183,0,0.3)' : 'rgba(0,255,180,0.3)';
            [[-20, -10], [20, -10], [-20, 10], [20, 10]].forEach(([ox, oy]) => {
                ctx.strokeStyle = thrustColor; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(sim.x + ox, sim.y + oy, 14, 0, Math.PI * 2); ctx.stroke();
            });

            // Drone Body
            ctx.fillStyle = S.risk > 0.78 ? 'rgba(255,68,68,0.9)' : S.risk > 0.38 ? 'rgba(255,183,0,0.9)' : 'rgba(0,255,180,0.9)';
            ctx.beginPath(); ctx.moveTo(sim.x - 14, sim.y); ctx.lineTo(sim.x, sim.y - 8); ctx.lineTo(sim.x + 14, sim.y); ctx.lineTo(sim.x, sim.y + 8); ctx.closePath(); ctx.fill();

            // HUD overlay on canvas
            ctx.fillStyle = 'rgba(0,255,180,0.8)'; ctx.font = '11px IBM Plex Mono, monospace';
            ctx.fillText(`RISK: ${S.risk.toFixed(3)}  |  BATT: ${Math.round(S.battery)}%  |  WIND: ${S.wind.toFixed(1)}m/s`, 10, h - 10);

            frameId = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(frameId);
    }, []);

    // Flight Path Loop
    useEffect(() => {
        const canvas = flightCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        let frameId: number;
        const render = () => {
            const w = canvas.width; const h = canvas.height;
            if (w <= 0 || h <= 0) { frameId = requestAnimationFrame(render); return; }

            ctx.fillStyle = '#0d1318'; ctx.fillRect(0, 0, w, h);
            const sim = simRef.current;
            sim.flightPath.push({ x: w / 2 + Math.sin(sim.tick * 0.02) * 60, y: h / 2 + Math.cos(sim.tick * 0.01) * 40 });
            if (sim.flightPath.length > 200) sim.flightPath.shift();

            ctx.strokeStyle = 'var(--green)'; ctx.lineWidth = 1; ctx.beginPath();
            sim.flightPath.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
            ctx.stroke();

            frameId = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(frameId);
    }, []);

    // Telemetry Tick
    useEffect(() => {
        const id = setInterval(() => {
            setState((prev) => {
                let newS = { ...prev };
                if (!prev.scenario) {
                    newS.battery = Math.max(0, prev.battery - 0.01);
                    newS.wind = Math.max(0, 6 + Math.sin(Date.now() / 2000) * 2);
                    newS.alt = 95 + Math.sin(Date.now() / 3000) * 5;
                }
                const { risk } = computeRisk(newS);

                // Auto-trigger on threshold cross
                if ((prev.risk < 0.4 && risk >= 0.4) || (prev.risk < 0.75 && risk >= 0.75)) {
                    requestNemotronDecision('THRESHOLD_VIOLATION');
                }

                newS.risk = risk;
                return newS;
            });
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const uptimeStr = () => {
        const sec = Math.floor((Date.now() - state.startTime) / 1000);
        return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    };

    const riskLabel = state.risk > 0.75 ? 'CRITICAL' : state.risk > 0.4 ? 'WARNING' : 'NOMINAL';

    return (
        <div className="layout">
            {/* HEADER */}
            <header className="header">
                <span className="header-logo">AFSM v2.4</span>
                <span className="header-sub">FLIGHT SAFETY AGENT</span>
                <div className="header-spacer" />
                <div className="header-stat">
                    <div className="pulse-dot" style={{ backgroundColor: state.risk > 0.75 ? 'var(--red)' : state.risk > 0.4 ? 'var(--amber)' : 'var(--green)' }} />
                    <span>STATUS</span>
                    <span className="val" style={{ color: state.risk > 0.75 ? 'var(--red)' : state.risk > 0.4 ? 'var(--amber)' : 'var(--green)' }}>{riskLabel}</span>
                </div>
                <div className="header-stat"><span>UPTIME</span><span className="val">{uptimeStr()}</span></div>
                <div className="header-stat"><span>EVENTS</span><span className="val">{state.totalEvents}</span></div>
            </header>

            {/* LEFT: TELEMETRY & TRIGGERS */}
            <div className="left-panel">
                <div className="panel-header"><span className="accent">▣</span> TELEMETRY FEED</div>
                <div className="metrics-section">
                    {[
                        { label: 'Battery', val: state.battery.toFixed(0) + '%', pct: state.battery, col: state.battery < 20 ? 'crit' : 'ok' },
                        { label: 'Wind', val: state.wind.toFixed(1) + ' m/s', pct: (state.wind / 30) * 100, col: state.wind > 20 ? 'crit' : 'ok' },
                        { label: 'Stability', val: state.stab.toFixed(2), pct: state.stab * 100, col: state.stab < 0.7 ? 'crit' : 'ok' },
                        { label: 'GPS', val: state.gps.toFixed(2), pct: state.gps * 100, col: state.gps < 0.4 ? 'crit' : 'ok' }
                    ].map(m => (
                        <div key={m.label} className={`metric-card ${m.col}`}>
                            <div className="metric-label">{m.label}</div>
                            <div className="metric-value">{m.val}</div>
                            <div className="metric-bar"><div className="metric-fill" style={{ width: `${m.pct}%`, background: m.col === 'crit' ? 'var(--red)' : 'var(--green)' }} /></div>
                        </div>
                    ))}
                </div>

                <div className="triggers-section">
                    <div className="triggers-label">SIMULATE DISTURBANCE</div>
                    <div className="trigger-grid">
                        {['wind', 'bird', 'battery', 'gps', 'turbulence', 'engine'].map((t) => (
                            <button key={t} className={`trigger-btn ${['bird', 'battery', 'engine'].includes(t) ? 'danger' : ''}`} onClick={() => inject(t as any)}>
                                <span className="t-name">{t.toUpperCase()}</span>
                                <span className="t-effect">Inject fault</span>
                            </button>
                        ))}
                    </div>
                    <button className="trigger-reset" onClick={() => inject('reset')}>RESET ALL SYSTEMS</button>
                </div>

                <div className="map-section">
                    <div className="panel-header"><span className="accent">◎</span> FLIGHT PATH MONITOR</div>
                    <div className="map-canvas-wrap"><canvas ref={flightCanvasRef} /></div>
                </div>
            </div>

            {/* CENTER: SIM & LOG */}
            <div className="center-panel">
                <div className="flight-view"><canvas ref={mainCanvasRef} /></div>
                <div className="log-section">
                    <div className="panel-header"><span className="accent">≡</span> DECISION LOG <span className="header-spacer" /> <span style={{ fontSize: '8px' }}>{logs.length} ENTRIES</span></div>
                    <div className="log-body">
                        {logs.map(log => (
                            <div key={log.id} className={`log-entry ${log.level}`}>
                                <span className="log-time">{log.time}</span>
                                <span className={`log-badge badge-${log.badge}`}>{log.badge.toUpperCase()}</span>
                                <span className="log-msg" dangerouslySetInnerHTML={{ __html: log.message }} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* RIGHT: AGENT CARDS */}
            <div className="right-panel">
                <div className="panel-header" style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                    <span>NEMOTRON SAFETY AGENT</span>
                    <span style={{ fontSize: '7px', color: 'var(--green-dim)', letterSpacing: '0.05em' }}>MODEL: nvidia nemotron nano 9b v2</span>
                </div>
                <div className="agent-section">
                    {agentCards.length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.4 }}>
                            <div className="pulse-dot" style={{ margin: '0 auto 15px' }} />
                            Monitoring flight parameters...
                        </div>
                    ) : (
                        agentCards.map(card => (
                            <div key={card.id} className={`agent-card ${card.severity}`} onClick={() => setSelectedCard(card)}>
                                <div className="agent-card-header">
                                    <span className="agent-card-title">{card.title}</span>
                                    <span className={`agent-card-score score-${card.severity}`}>{card.risk.toFixed(2)}</span>
                                </div>
                                <div className="agent-card-body">{card.body}</div>
                                <div className="cmd-block">
                                    <div className="cmd-label">DECISION</div>
                                    {card.command}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* MODAL */}
            <div className={`modal-overlay ${selectedCard ? 'active' : ''}`} onClick={() => setSelectedCard(null)}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <div style={{ fontWeight: 600 }}>AGENT ANALYSIS: {selectedCard?.title}</div>
                        <button style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '18px' }} onClick={() => setSelectedCard(null)}>✕</button>
                    </div>
                    <div className="modal-content">
                        <div className="modal-section">
                            <div className="modal-section-title">Evidence & Reasoning</div>
                            <div className="modal-text">{selectedCard?.body}</div>
                            <div className="evidence">
                                {selectedCard?.issues.map((iss, i) => (
                                    <div key={i}>{iss.key}: {iss.val} (Threshold: {iss.threshold})</div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-section">
                            <div className="modal-section-title">Intervention Plan</div>
                            {selectedCard?.plan.map((p, i) => (
                                <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', marginBottom: '4px' }}>
                                    <span style={{ color: 'var(--blue)' }}>0{i + 1}</span> <span>{p.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="cmd-action-row">
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--blue)' }}>{selectedCard?.command}</div>
                        <button className="cmd-execute-btn" onClick={() => selectedCard && executeCommand(selectedCard)}>EXECUTE</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
