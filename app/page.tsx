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
    badge: 'ok' | 'warn' | 'crit' | 'cmd' | 'agent';
    message: string;
    time: string;
}

interface AgentCard {
    id: string;
    severity: 'ok' | 'warn' | 'crit';
    title: string;
    body: string;
    plan: { text: string; pri: string }[];
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
        issues.push({ key: 'BATTERY_CRITICAL', val: s.battery.toFixed(0) + '%', threshold: '10%', delta: '+' + (10 - s.battery).toFixed(1) + '%' });
    } else if (s.battery < 20) {
        r += 0.28;
        issues.push({ key: 'BATTERY_LOW', val: s.battery.toFixed(0) + '%', threshold: '20%', delta: '+' + (20 - s.battery).toFixed(1) + '%' });
    }
    if (s.wind > 24) {
        r += 0.38;
        issues.push({ key: 'WIND_CRITICAL', val: s.wind.toFixed(1) + 'm/s', threshold: '24m/s', delta: '+' + (s.wind - 24).toFixed(1) });
    } else if (s.wind > 16) {
        r += 0.22;
        issues.push({ key: 'HIGH_WIND', val: s.wind.toFixed(1) + 'm/s', threshold: '16m/s', delta: '+' + (s.wind - 16).toFixed(1) });
    }
    if (s.stab < 0.62) {
        r += 0.35;
        issues.push({ key: 'WING_INSTABILITY', val: s.stab.toFixed(2), threshold: '0.75', delta: (s.stab - 0.75).toFixed(2) });
    } else if (s.stab < 0.82) {
        r += 0.18;
        issues.push({ key: 'REDUCED_STABILITY', val: s.stab.toFixed(2), threshold: '0.82', delta: (s.stab - 0.82).toFixed(2) });
    }
    if (s.gps < 0.25) {
        r += 0.28;
        issues.push({ key: 'GPS_SIGNAL_LOSS', val: s.gps.toFixed(2), threshold: '0.40', delta: (s.gps - 0.4).toFixed(2) });
    }
    if (s.temp > 52) {
        r += 0.15;
        issues.push({ key: 'THERMAL_WARNING', val: s.temp.toFixed(0) + '°C', threshold: '50°C', delta: '+' + (s.temp - 50).toFixed(0) + '°' });
    }
    return { risk: Math.min(1, Math.max(0, r)), issues };
}

interface Cloud { x: number; y: number; w: number; spd: number; }
interface Bird { x: number; y: number; vx: number; vy: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }

const MODEL_LABEL = 'nvidia/nemotron-nano-9b-v2';
const HISTORY_LEN = 40;

type MetricKey = 'battery' | 'wind' | 'alt' | 'stab' | 'gps' | 'temp';

interface TelemetryHistory {
    battery: number[];
    wind: number[];
    alt: number[];
    stab: number[];
    gps: number[];
    temp: number[];
}

// ── Sparkline SVG component ──────────────────────────────────────────────────
function Sparkline({ values, color, warnVal, critVal, maxVal, minVal = 0 }: {
    values: number[];
    color: string;
    warnVal?: number;
    critVal?: number;
    maxVal: number;
    minVal?: number;
}) {
    if (values.length < 2) return <svg width="100%" height="22" />;
    const W = 110, H = 22;
    const range = maxVal - minVal || 1;
    const toY = (v: number) => H - ((v - minVal) / range) * H;
    const toX = (i: number) => (i / (HISTORY_LEN - 1)) * W;

    const pts = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const last = values[values.length - 1];
    const lineColor = critVal !== undefined && last <= critVal
        ? 'var(--red)'
        : warnVal !== undefined && last <= warnVal
            ? 'var(--amber)'
            : critVal !== undefined && last >= critVal
                ? 'var(--red)'
                : warnVal !== undefined && last >= warnVal
                    ? 'var(--amber)'
                    : color;

    return (
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
            {/* fill area */}
            <defs>
                <linearGradient id={`sg-${color.replace(/[^a-z]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <polygon
                points={`${toX(0).toFixed(1)},${H} ${pts} ${toX(values.length - 1).toFixed(1)},${H}`}
                fill={`url(#sg-${color.replace(/[^a-z]/gi, '')})`}
            />
            {/* warn threshold */}
            {warnVal !== undefined && (
                <line x1="0" y1={toY(warnVal)} x2={W} y2={toY(warnVal)}
                      stroke="var(--amber)" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.5" />
            )}
            {/* crit threshold */}
            {critVal !== undefined && (
                <line x1="0" y1={toY(critVal)} x2={W} y2={toY(critVal)}
                      stroke="var(--red)" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.5" />
            )}
            {/* line */}
            <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
            {/* last dot */}
            <circle cx={toX(values.length - 1)} cy={toY(last)} r="1.8" fill={lineColor} />
        </svg>
    );
}

// ── Full chart in modal ──────────────────────────────────────────────────────
function TelemetryChart({ values, color, warnVal, critVal, maxVal, minVal = 0, unit }: {
    values: number[];
    color: string;
    warnVal?: number;
    critVal?: number;
    maxVal: number;
    minVal?: number;
    unit: string;
}) {
    if (values.length < 2) return <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>Collecting data…</div>;
    const W = 520, H = 90;
    const PAD = { t: 8, r: 8, b: 20, l: 36 };
    const cW = W - PAD.l - PAD.r;
    const cH = H - PAD.t - PAD.b;
    const range = maxVal - minVal || 1;
    const toY = (v: number) => PAD.t + cH - ((v - minVal) / range) * cH;
    const toX = (i: number) => PAD.l + (i / (HISTORY_LEN - 1)) * cW;

    const pts = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const last = values[values.length - 1];
    const lineColor = critVal !== undefined && (last <= critVal || last >= critVal * 1.0)
        ? (critVal < warnVal! ? (last <= critVal ? 'var(--red)' : last <= warnVal! ? 'var(--amber)' : color)
            : (last >= critVal ? 'var(--red)' : last >= (warnVal ?? 0) ? 'var(--amber)' : color))
        : color;

    // y-axis ticks
    const ticks = 4;
    const tickVals = Array.from({ length: ticks + 1 }, (_, i) => minVal + (range / ticks) * i);

    return (
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', overflow: 'visible' }}>
            <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
                </linearGradient>
                <clipPath id="chart-clip">
                    <rect x={PAD.l} y={PAD.t} width={cW} height={cH} />
                </clipPath>
            </defs>

            {/* grid lines */}
            {tickVals.map((v, i) => (
                <g key={i}>
                    <line x1={PAD.l} y1={toY(v)} x2={PAD.l + cW} y2={toY(v)}
                          stroke="rgba(0,255,180,0.06)" strokeWidth="0.5" />
                    <text x={PAD.l - 4} y={toY(v) + 3} textAnchor="end"
                          fill="rgba(90,112,128,0.8)" fontSize="7" fontFamily="IBM Plex Mono, monospace">
                        {v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}
                    </text>
                </g>
            ))}

            {/* time axis labels */}
            {[0, 10, 20, 30, 39].map((idx) => (
                values[idx] !== undefined && (
                    <text key={idx} x={toX(idx)} y={H - 4} textAnchor="middle"
                          fill="rgba(90,112,128,0.7)" fontSize="7" fontFamily="IBM Plex Mono, monospace">
                        -{(HISTORY_LEN - 1 - idx)}s
                    </text>
                )
            ))}

            {/* warn threshold */}
            {warnVal !== undefined && (
                <g clipPath="url(#chart-clip)">
                    <line x1={PAD.l} y1={toY(warnVal)} x2={PAD.l + cW} y2={toY(warnVal)}
                          stroke="var(--amber)" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.6" />
                    <text x={PAD.l + cW - 2} y={toY(warnVal) - 2} textAnchor="end"
                          fill="var(--amber)" fontSize="7" fontFamily="IBM Plex Mono, monospace" opacity="0.8">WARN</text>
                </g>
            )}
            {/* crit threshold */}
            {critVal !== undefined && (
                <g clipPath="url(#chart-clip)">
                    <line x1={PAD.l} y1={toY(critVal)} x2={PAD.l + cW} y2={toY(critVal)}
                          stroke="var(--red)" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.6" />
                    <text x={PAD.l + cW - 2} y={toY(critVal) - 2} textAnchor="end"
                          fill="var(--red)" fontSize="7" fontFamily="IBM Plex Mono, monospace" opacity="0.8">CRIT</text>
                </g>
            )}

            {/* fill */}
            <polygon clipPath="url(#chart-clip)"
                     points={`${toX(0).toFixed(1)},${PAD.t + cH} ${pts} ${toX(values.length - 1).toFixed(1)},${PAD.t + cH}`}
                     fill="url(#chart-fill)" />

            {/* line */}
            <polyline clipPath="url(#chart-clip)"
                      points={pts} fill="none" stroke={lineColor} strokeWidth="1.5"
                      strokeLinejoin="round" strokeLinecap="round" />

            {/* last value dot + label */}
            <circle cx={toX(values.length - 1)} cy={toY(last)} r="3" fill={lineColor} />
            <text x={toX(values.length - 1) + 5} y={toY(last) + 3}
                  fill={lineColor} fontSize="9" fontFamily="IBM Plex Mono, monospace" fontWeight="500">
                {last % 1 === 0 ? last.toFixed(0) : last.toFixed(2)}{unit}
            </text>
        </svg>
    );
}

export default function HomePage() {
    const [mounted, setMounted] = useState(false);
    const [state, setState] = useState<TelemetryState>(initialState);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [agentCards, setAgentCards] = useState<AgentCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<AgentCard | null>(null);
    const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
    const [history, setHistory] = useState<TelemetryHistory>({
        battery: [], wind: [], alt: [], stab: [], gps: [], temp: [],
    });

    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    const lastDecisionTimeRef = useRef(0);

    const simRef = useRef({
        x: 0, y: 0, heading: 0, tick: 0, worldScroll: 0,
        clouds: [] as Cloud[],
        birds: [] as Bird[],
        particles: [] as Particle[],
        cloudsInitialized: false,
    });

    const addLog = (level: LogLevel, badge: LogEntry['badge'], message: string) => {
        const now = new Date();
        const t = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).slice(0, 1)}`;
        setLogs((prev) => [{ id: Date.now() + Math.random(), level, badge, message, time: t }, ...prev.slice(0, 59)]);
        setState((prev) => ({ ...prev, totalEvents: prev.totalEvents + 1 }));
    };
    const addLogRef = useRef(addLog);
    addLogRef.current = addLog;

    // ── AI Decision Request ──────────────────────────────────────────────────
    const requestAIDecision = async (trigger: string) => {
        const now = Date.now();
        if (now - lastDecisionTimeRef.current < 2500) return;
        lastDecisionTimeRef.current = now;

        addLogRef.current('cmd', 'agent', `${MODEL_LABEL}: Analyzing safety state (Trigger: ${trigger})`);

        try {
            const { issues } = computeRiskAndIssues(stateRef.current);
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
                        risk: stateRef.current.risk,
                    },
                    issues,
                    trigger,
                }),
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);
            const decision = await response.json();

            const rules = Array.isArray(decision.triggered_rules) ? decision.triggered_rules : [];
            const severity: AgentCard['severity'] =
                decision.safety_state === 'CRITICAL' ? 'crit' :
                    decision.safety_state === 'WARNING' ? 'warn' : 'ok';

            const newCard: AgentCard = {
                id: Math.random().toString(36).substr(2, 9),
                severity,
                title: decision.recommended_action.replace(/_/g, ' '),
                body: Array.isArray(decision.reasoning_bullets) ? decision.reasoning_bullets.join(' · ') : '',
                plan: (decision.reasoning_bullets ?? []).map((b: string) => ({
                    text: b,
                    pri: severity === 'crit' ? 'high' : 'med',
                })),
                command: decision.command,
                issues: rules.map((r: any) => ({
                    key: r.rule_id,
                    val: String(r.value),
                    threshold: String(r.threshold),
                })),
                risk: decision.risk_score,
                ts: Date.now(),
            };

            if (newCard.severity !== 'ok') {
                setAgentCards((prev) => [newCard, ...prev.slice(0, 19)]);
                addLogRef.current(
                    severity === 'crit' ? 'crit' : 'warn',
                    'agent',
                    `${MODEL_LABEL} DECISION: ${newCard.title} → ${newCard.command}`
                );
            } else {
                addLogRef.current('ok', 'agent', `${MODEL_LABEL}: System NOMINAL. No intervention required.`);
            }
        } catch (err) {
            addLogRef.current('warn', 'agent', `${MODEL_LABEL}: Analysis failed. Local safety rules active.`);
        }
    };

    const inject = (type: 'wind' | 'bird' | 'battery' | 'gps' | 'turbulence' | 'engine' | 'reset') => {
        setState((prev) => {
            if (type === 'reset') {
                addLogRef.current('ok', 'ok', 'System RESET — all parameters restored to nominal baseline');
                setAgentCards([]);
                setLogs([]);
                setHistory({ battery: [], wind: [], alt: [], stab: [], gps: [], temp: [] });
                return { ...initialState, startTime: prev.startTime };
            }
            let s: TelemetryState = { ...prev, scenario: type };
            if (type === 'wind') {
                s.wind = 26 + Math.random() * 3;
                addLogRef.current('warn', 'warn', `DISTURBANCE — Wind spike: ${s.wind.toFixed(1)} m/s. Exceeds CRITICAL threshold of 24 m/s`);
            } else if (type === 'bird') {
                s.stab = 0.58 + Math.random() * 0.06;
                addLogRef.current('crit', 'crit', `DISTURBANCE — Wing stability CRITICAL drop to ${s.stab.toFixed(2)}. Possible bird strike`);
            } else if (type === 'battery') {
                s.battery = 7 + Math.random() * 2;
                addLogRef.current('crit', 'crit', `DISTURBANCE — Battery CRITICAL at ${s.battery.toFixed(0)}%. Immediate action required`);
            } else if (type === 'gps') {
                s.gps = 0.08 + Math.random() * 0.1;
                addLogRef.current('warn', 'warn', `DISTURBANCE — GPS signal loss. Strength: ${s.gps.toFixed(2)}`);
            } else if (type === 'turbulence') {
                s.stab -= 0.12; s.wind += 8; s.alt += 15;
                addLogRef.current('warn', 'warn', 'DISTURBANCE — Turbulence: wind +8 m/s, stability -0.12, alt ±15m');
            } else if (type === 'engine') {
                s.stab -= 0.08; s.temp += 18;
                addLogRef.current('crit', 'crit', `DISTURBANCE — Engine vibration. Temp spike to ${s.temp.toFixed(0)}°C`);
            }
            s.risk = computeRiskAndIssues(s).risk;
            return s;
        });

        if (type !== 'reset') {
            requestAIDecision(`INJECT_${type.toUpperCase()}`);
        }
    };

    const executeCommand = (card: AgentCard) => {
        addLogRef.current('cmd', 'cmd', `EXECUTE: Operator accepted ${card.title} [${card.command}]`);
        addLogRef.current('ok', 'ok', 'Agent: Command acknowledged — monitoring effect on flight parameters');
        setSelectedCard(null);
        requestAIDecision('COMMAND_EXECUTED');
    };

    useEffect(() => { setMounted(true); }, []);

    // Resize canvas
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

    // Flight simulation canvas
    useEffect(() => {
        const canvas = mainCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        let frameId: number;
        const sim = simRef.current;

        const render = () => {
            const w = canvas.width, h = canvas.height;
            const S = stateRef.current;
            if (w <= 0 || h <= 0) { frameId = requestAnimationFrame(render); return; }

            if (!sim.cloudsInitialized || sim.clouds.length === 0) {
                sim.cloudsInitialized = true;
                sim.clouds = Array.from({ length: 8 }, () => ({
                    x: Math.random() * (w + 400), y: 40 + Math.random() * 120,
                    w: 60 + Math.random() * 80, spd: 0.2 + Math.random() * 0.3,
                }));
            }

            sim.tick += 1;
            sim.worldScroll += 0.9;
            sim.x = w / 2;
            sim.y = h * 0.45 - (S.alt - 50) * 1.2 + (S.stab < 0.75 ? Math.sin(sim.tick * 0.3) * 18 : 0);
            sim.heading = -0.05;

            const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
            sky.addColorStop(0, '#040810'); sky.addColorStop(0.5, '#080f1a'); sky.addColorStop(1, '#0c1520');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.65);

            const grd = ctx.createLinearGradient(0, h * 0.65, 0, h);
            grd.addColorStop(0, '#0a1505'); grd.addColorStop(1, '#060d04');
            ctx.fillStyle = grd; ctx.fillRect(0, h * 0.65, w, h * 0.35);

            ctx.strokeStyle = 'rgba(0,255,180,0.07)'; ctx.lineWidth = 1; ctx.setLineDash([4, 8]);
            ctx.beginPath(); ctx.moveTo(0, h * 0.65); ctx.lineTo(w, h * 0.65); ctx.stroke();
            ctx.setLineDash([]);

            const gridStep = 40;
            const scrollOff = sim.worldScroll % gridStep;
            ctx.strokeStyle = 'rgba(0,255,180,0.04)'; ctx.lineWidth = 0.5;
            for (let i = -1; i <= w / gridStep + 2; i++) {
                const gx = i * gridStep - scrollOff;
                ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h * 0.65); ctx.stroke();
            }
            for (let gy = 0; gy < h * 0.65; gy += gridStep) {
                ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
            }

            const altPct = Math.min(1, S.alt / 150);
            const altY = h * 0.65 - altPct * (h * 0.6);
            ctx.strokeStyle = 'rgba(77,184,255,0.3)'; ctx.setLineDash([3, 6]); ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(0, altY); ctx.lineTo(w, altY); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(77,184,255,0.6)'; ctx.font = '9px IBM Plex Mono, monospace';
            ctx.fillText(`${Math.round(S.alt)}m`, 4, altY - 3);

            sim.clouds.forEach((cl) => {
                let screenX = cl.x - sim.worldScroll;
                if (screenX < -cl.w - 50) { cl.x += w + 2 * cl.w + 100; screenX = cl.x - sim.worldScroll; }
                ctx.fillStyle = `rgba(100,180,255,${S.wind > 18 ? 0.12 : 0.07})`;
                ctx.beginPath(); ctx.ellipse(screenX, cl.y, cl.w / 2, cl.w / 5, 0, 0, Math.PI * 2); ctx.fill();
            });

            if (S.wind > 10) {
                const wIntensity = (S.wind - 10) / 20;
                for (let i = 0; i < 5; i++) {
                    const wy = 80 + i * 60;
                    const len = 30 + wIntensity * 60;
                    const base = sim.tick * S.wind * 0.3 + i * 120 - sim.worldScroll;
                    const offset = ((base % (w + 100)) + (w + 100)) % (w + 100) - 50;
                    ctx.strokeStyle = `rgba(77,184,255,${0.1 + wIntensity * 0.2})`; ctx.lineWidth = 0.8;
                    ctx.setLineDash([len, 20 + Math.random() * 40]);
                    ctx.beginPath(); ctx.moveTo(offset, wy); ctx.lineTo(offset + len, wy); ctx.stroke();
                }
                ctx.setLineDash([]);
            }

            if (S.scenario === 'bird' && sim.birds.length === 0) {
                sim.birds = Array.from({ length: 4 }, () => ({
                    x: Math.random() * w, y: 80 + Math.random() * 100,
                    vx: -1.5 - Math.random(), vy: 0.3 - Math.random() * 0.6,
                }));
            }
            if (S.scenario !== 'bird') sim.birds = [];
            sim.birds.forEach((b) => {
                b.x += b.vx; b.y += b.vy;
                if (b.x < -20) b.x = w + 20;
                ctx.strokeStyle = 'rgba(255,180,100,0.7)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(b.x - 6, b.y + 3); ctx.quadraticCurveTo(b.x, b.y - 4, b.x + 6, b.y + 3); ctx.stroke();
            });

            if (S.scenario === 'turbulence' || S.scenario === 'engine') {
                for (let i = 0; i < 3; i++) {
                    sim.particles.push({ x: sim.x, y: sim.y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 40, color: 'rgba(255,183,0,' });
                }
            }
            sim.particles = sim.particles.filter((p) => p.life > 0);
            sim.particles.forEach((p) => {
                p.x += p.vx; p.y += p.vy; p.life -= 1;
                ctx.fillStyle = p.color + (p.life / 40) * 0.6 + ')';
                ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
            });

            const thrustColor = S.risk > 0.78 ? 'rgba(255,68,68,0.4)' : S.risk > 0.38 ? 'rgba(255,183,0,0.3)' : 'rgba(0,255,180,0.3)';
            [[-20, -10], [20, -10], [-20, 10], [20, 10]].forEach(([ox, oy]) => {
                const rx = sim.x + ox, ry = sim.y + oy;
                ctx.strokeStyle = thrustColor; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(rx, ry, 14, 0, Math.PI * 2); ctx.stroke();
                const angle = sim.tick * 0.35;
                ctx.strokeStyle = 'rgba(180,220,255,0.5)'; ctx.lineWidth = 1.5;
                for (let r = 0; r < 2; r++) {
                    const a = angle + r * Math.PI;
                    ctx.beginPath();
                    ctx.moveTo(rx + Math.cos(a) * 11, ry + Math.sin(a) * 11);
                    ctx.lineTo(rx - Math.cos(a) * 11, ry - Math.sin(a) * 11);
                    ctx.stroke();
                }
            });

            ctx.save(); ctx.translate(sim.x, sim.y); ctx.rotate(sim.heading * 0.2);
            const bodyColor = S.risk > 0.78 ? 'rgba(255,68,68,0.9)' : S.risk > 0.38 ? 'rgba(255,183,0,0.9)' : 'rgba(0,255,180,0.9)';
            ctx.fillStyle = bodyColor; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(0, -8); ctx.lineTo(14, 0); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = 'rgba(150,200,255,0.4)'; ctx.lineWidth = 1.5;
            [[-20, -10], [20, -10], [-20, 10], [20, 10]].forEach(([ox, oy]) => {
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ox, oy); ctx.stroke();
            });
            const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
            glow.addColorStop(0, S.risk > 0.78 ? 'rgba(255,68,68,0.15)' : S.risk > 0.38 ? 'rgba(255,183,0,0.12)' : 'rgba(0,255,180,0.1)');
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
            ctx.restore();

            ctx.fillStyle = 'rgba(0,255,180,0.8)'; ctx.font = '11px IBM Plex Mono, monospace';
            ctx.fillText(`RISK: ${S.risk.toFixed(3)}  ALT: ${Math.round(S.alt)}m  WIND: ${S.wind.toFixed(1)}m/s`, 10, h - 10);

            frameId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(frameId);
    }, []);

    // Telemetry tick + auto AI trigger on threshold cross
    useEffect(() => {
        const id = setInterval(() => {
            setState((prev) => {
                let newS = { ...prev };
                if (!prev.scenario) {
                    newS.battery = Math.max(0, prev.battery - 0.01);
                    newS.wind = Math.max(0, 6 + Math.sin(Date.now() / 2000) * 2);
                    newS.alt = 95 + Math.sin(Date.now() / 3000) * 5;
                }
                const { risk } = computeRiskAndIssues(newS);
                if ((prev.risk < 0.4 && risk >= 0.4) || (prev.risk < 0.75 && risk >= 0.75)) {
                    requestAIDecision('THRESHOLD_VIOLATION');
                }
                newS.risk = risk;
                return newS;
            });
        }, 1000);
        return () => clearInterval(id);
    }, []);

    // History sampling — 1 sample/sec, keep last HISTORY_LEN points
    useEffect(() => {
        const id = setInterval(() => {
            const S = stateRef.current;
            setHistory((prev) => ({
                battery: [...prev.battery, S.battery].slice(-HISTORY_LEN),
                wind:    [...prev.wind,    S.wind].slice(-HISTORY_LEN),
                alt:     [...prev.alt,     S.alt].slice(-HISTORY_LEN),
                stab:    [...prev.stab,    S.stab].slice(-HISTORY_LEN),
                gps:     [...prev.gps,     S.gps].slice(-HISTORY_LEN),
                temp:    [...prev.temp,    S.temp].slice(-HISTORY_LEN),
            }));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    // Periodic nominal log
    useEffect(() => {
        if (!mounted) return;
        const id = setInterval(() => {
            const S = stateRef.current;
            const { risk, issues } = computeRiskAndIssues(S);
            if (risk > 0.78) {
                addLogRef.current('crit', 'crit', `Agent: CRITICAL — Risk ${risk.toFixed(2)}. ${issues.map(i => i.key).join(', ')}.`);
            } else if (risk > 0.38) {
                addLogRef.current('warn', 'warn', `Agent: WARNING — Risk ${risk.toFixed(2)}. ${issues[0]?.key ?? 'Elevated'}: ${issues[0]?.val ?? '–'}.`);
            } else {
                addLogRef.current('ok', 'ok', `Agent: Nominal. Risk ${risk.toFixed(2)} · Batt ${Math.round(S.battery)}% · Wind ${S.wind.toFixed(1)} m/s · Alt ${Math.round(S.alt)} m.`);
            }
        }, 2500);
        return () => clearInterval(id);
    }, [mounted]);

    const uptimeSeconds = mounted ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
    const minutes = String(Math.floor(uptimeSeconds / 60)).padStart(2, '0');
    const seconds = String(uptimeSeconds % 60).padStart(2, '0');
    const riskLabel = state.risk > 0.78 ? 'CRITICAL' : state.risk > 0.38 ? 'WARNING' : 'NOMINAL';
    const riskStatusText = state.risk > 0.78 ? 'CRITICAL' : state.risk > 0.38 ? 'WARNING' : 'SAFE';
    const riskColor = state.risk > 0.78 ? 'var(--red)' : state.risk > 0.38 ? 'var(--amber)' : 'var(--green)';
    const confPct = Math.round((1 - state.risk) * 100);
    const riskPointerLeft = Math.min(92, Math.max(4, state.risk * 92 + 4));

    return (
        <div className="layout">
            {/* HEADER */}
            <header className="header">
                <span className="header-logo">AFSM v2.4</span>
                <span className="header-sub">AUTONOMOUS FLIGHT SAFETY MONITOR</span>
                <div className="header-spacer" />
                <div className="header-stat">
                    <span className="pulse-dot" />
                    <span>STATUS</span>
                    <span className="val">{riskLabel}</span>
                </div>
                <div className="header-stat"><span>DRONE</span><span className="val">DRONE_001</span></div>
                <div className="header-stat"><span>UPTIME</span><span className="val">{minutes}:{seconds}</span></div>
                <div className="header-stat"><span>EVENTS</span><span className="val">{state.totalEvents}</span></div>
            </header>

            {/* LEFT PANEL */}
            <div className="left-panel">
                <div className="panel-header"><span className="accent">▣</span> TELEMETRY · LIVE</div>
                <div className="metrics-section">
                    {([
                        { key: 'battery' as MetricKey, label: 'Battery',  val: Math.round(state.battery),   unit: '%',   pct: state.battery,            col: state.battery < 15 ? 'var(--red)' : state.battery < 30 ? 'var(--amber)' : 'var(--green)', trend: state.battery < 15 ? '⚠ CRITICAL LOW' : state.battery < 30 ? '▼ low' : '▼ draining', sparkMax: 100, sparkWarn: 20,   sparkCrit: 10   },
                        { key: 'wind'    as MetricKey, label: 'Wind',     val: state.wind.toFixed(1),        unit: 'm/s', pct: (state.wind / 30) * 100,  col: state.wind > 24 ? 'var(--red)' : state.wind > 16 ? 'var(--amber)' : 'var(--green)',       trend: state.wind > 24 ? '▲ EXCEEDED' : state.wind > 16 ? '▲ HIGH' : 'stable',           sparkMax: 35,  sparkWarn: 16,   sparkCrit: 24   },
                        { key: 'alt'     as MetricKey, label: 'Altitude', val: Math.round(state.alt),        unit: 'm',   pct: (state.alt / 150) * 100,  col: 'var(--blue)',                                                                            trend: state.alt > 120 ? '▲ HIGH' : 'holding',                                           sparkMax: 150, sparkWarn: undefined, sparkCrit: undefined },
                        { key: 'stab'    as MetricKey, label: 'Wing Stab',val: state.stab.toFixed(2),        unit: '',    pct: state.stab * 100,         col: state.stab < 0.62 ? 'var(--red)' : state.stab < 0.82 ? 'var(--amber)' : 'var(--green)',   trend: state.stab < 0.62 ? '⚠ UNSTABLE' : state.stab < 0.82 ? '⚠ DEGRADED' : 'nominal', sparkMax: 1,   sparkWarn: 0.82, sparkCrit: 0.62 },
                        { key: 'gps'     as MetricKey, label: 'GPS Sig',  val: state.gps.toFixed(2),         unit: '',    pct: state.gps * 100,          col: state.gps < 0.25 ? 'var(--red)' : state.gps < 0.5 ? 'var(--amber)' : 'var(--green)',     trend: state.gps < 0.25 ? '⊘ LOSS' : state.gps < 0.5 ? '⚠ WEAK' : 'strong',             sparkMax: 1,   sparkWarn: 0.5,  sparkCrit: 0.25 },
                        { key: 'temp'    as MetricKey, label: 'Temp',     val: Math.round(state.temp),       unit: '°C',  pct: (state.temp / 80) * 100,  col: state.temp > 55 ? 'var(--red)' : 'var(--amber)',                                         trend: state.temp > 55 ? '⚠ CRITICAL' : state.temp > 45 ? '⚠ HOT' : 'normal',           sparkMax: 80,  sparkWarn: 45,   sparkCrit: 55   },
                    ] as const).map((m) => (
                        <button key={m.key} type="button" className="metric-card" onClick={() => setSelectedMetric(m.key)}>
                            <div className="metric-label">{m.label}</div>
                            <div className="metric-value">{m.val}<span className="metric-unit">{m.unit}</span></div>
                            <div className="metric-bar"><div className="metric-fill" style={{ width: `${m.pct}%`, background: m.col }} /></div>
                            <div className="metric-trend">{m.trend}</div>
                            <div className="sparkline-wrap">
                                <Sparkline
                                    values={history[m.key]}
                                    color={m.col}
                                    maxVal={m.sparkMax}
                                    warnVal={m.sparkWarn}
                                    critVal={m.sparkCrit}
                                />
                            </div>
                        </button>
                    ))}
                </div>

                {/* Risk score panel */}
                <div className="risk-section">
                    <div className="risk-row">
                        <div className="risk-score-big" style={{ color: riskColor }}>{state.risk.toFixed(2)}</div>
                        <div className="risk-label-col">
                            <div className="risk-status" style={{ color: riskColor }}>{riskStatusText}</div>
                            <div className={`mode-badge ${state.risk > 0.78 ? 'mode-autonomous' : 'mode-advisory'}`}>
                                <span className="pulse-dot" />
                                <span className="mode-text">{state.risk > 0.78 ? 'AUTONOMOUS MODE' : 'ADVISORY MODE'}</span>
                            </div>
                            <div className="risk-conf">CONF: <span className="conf-val">{confPct}%</span></div>
                        </div>
                    </div>
                    <div className="risk-bar-track">
                        <div className="risk-pointer" style={{ left: `${riskPointerLeft}%` }} />
                    </div>
                </div>

                <div className="triggers-section">
                    <div className="triggers-label">INJECT DISTURBANCE</div>
                    <div className="trigger-grid">
                        <button type="button" className="trigger-btn" onClick={() => inject('wind')}>
                            <span className="trigger-icon" aria-hidden>⟳</span>
                            <span className="trigger-text"><span className="t-name">Wind Spike</span><span className="t-effect">→ 26 m/s gust</span></span>
                        </button>
                        <button type="button" className="trigger-btn danger" onClick={() => inject('bird')}>
                            <span className="trigger-icon" aria-hidden>✕</span>
                            <span className="trigger-text"><span className="t-name">Bird Strike</span><span className="t-effect">→ stab drop</span></span>
                        </button>
                        <button type="button" className="trigger-btn danger" onClick={() => inject('battery')}>
                            <span className="trigger-icon" aria-hidden>⚡</span>
                            <span className="trigger-text"><span className="t-name">Batt Drop</span><span className="t-effect">→ critical 8%</span></span>
                        </button>
                        <button type="button" className="trigger-btn" onClick={() => inject('gps')}>
                            <span className="trigger-icon" aria-hidden>⊘</span>
                            <span className="trigger-text"><span className="t-name">GPS Jam</span><span className="t-effect">→ signal loss</span></span>
                        </button>
                        <button type="button" className="trigger-btn" onClick={() => inject('turbulence')}>
                            <span className="trigger-icon" aria-hidden>≈</span>
                            <span className="trigger-text"><span className="t-name">Turbulence</span><span className="t-effect">→ multi-axis</span></span>
                        </button>
                        <button type="button" className="trigger-btn danger" onClick={() => inject('engine')}>
                            <span className="trigger-icon" aria-hidden>⚠</span>
                            <span className="trigger-text"><span className="t-name">Engine Vibe</span><span className="t-effect">→ mech fault</span></span>
                        </button>
                    </div>
                    <button type="button" className="trigger-reset" onClick={() => inject('reset')}>
                        <span className="trigger-reset-icon" aria-hidden>↺</span> RESET ALL SYSTEMS
                    </button>
                </div>
            </div>

            {/* CENTER PANEL */}
            <div className="center-panel">
                <div className="panel-header"><span className="accent">◈</span> LIVE FLIGHT SIMULATION</div>
                <div className="flight-view"><canvas ref={mainCanvasRef} /></div>
                <div className="log-section">
                    <div className="panel-header">
                        <span className="accent">≡</span> AGENT DECISION LOG
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{logs.length} entries</span>
                    </div>
                    <div className="log-body">
                        {logs.slice(0, 60).map((log) => (
                            <div key={log.id} className={`log-entry ${log.level}`}>
                                <span className="log-time">{log.time}</span>
                                <span className={`log-badge badge-${log.badge}`}>{log.badge.toUpperCase()}</span>
                                <span className="log-msg">{log.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* RIGHT PANEL */}
            <div className="right-panel">
                <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span><span className="accent">◆</span> AI FLIGHT SAFETY AGENT</span>
                    <span style={{ fontSize: 7, color: 'var(--green-dim)', letterSpacing: '0.05em' }}>MODEL: {MODEL_LABEL}</span>
                </div>
                <div className="agent-section">
                    {agentCards.length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)' }}>
                            Agent monitoring...<br /><br />
                            <div className="pulse-dot" style={{ margin: '0 auto' }} />
                        </div>
                    ) : (
                        agentCards.map((card) => (
                            <div
                                key={card.id}
                                className={`agent-card ${card.severity}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedCard(card)}
                                onKeyDown={(e) => e.key === 'Enter' && setSelectedCard(card)}
                            >
                                <div className="agent-card-header">
                                    <span className="agent-card-icon">{card.severity === 'crit' ? '⚠' : '▲'}</span>
                                    <span className="agent-card-title">{card.title}</span>
                                    <span className={`agent-card-score score-${card.severity}`}>{card.risk.toFixed(2)}</span>
                                </div>
                                <div className="agent-card-body">
                                    {card.body}
                                    {card.issues.length > 0 && (
                                        <div className="evidence">
                                            {card.issues.map((e, i) => (
                                                <span key={e.key}>{i > 0 && ' · '}{e.key}: <span>{e.val}</span></span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="cmd-block">
                                    <div className="cmd-label">DECISION</div>
                                    {card.command}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* TELEMETRY DETAIL MODAL */}
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
                                <div className="modal-sub">Live telemetry analysis · {new Date().toLocaleTimeString()}</div>
                            </div>
                            <button type="button" className="modal-close" onClick={() => setSelectedMetric(null)} aria-label="Close">✕</button>
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
                                    {selectedMetric === 'battery' && (state.battery < 20
                                        ? `Battery at ${state.battery.toFixed(1)}%. Below warning threshold — return to base recommended.`
                                        : `Battery at ${state.battery.toFixed(1)}%. Nominal — estimated ${Math.round(state.battery * 1.2)} min remaining.`)}
                                    {selectedMetric === 'wind' && (state.wind > 16
                                        ? `Wind speed ${state.wind.toFixed(1)} m/s. Above safe operational limit — altitude reduction recommended.`
                                        : `Wind speed ${state.wind.toFixed(1)} m/s. Within safe operating envelope.`)}
                                    {selectedMetric === 'alt' && (state.alt > 120
                                        ? `Current altitude ${state.alt.toFixed(0)} m. Approaching regulatory ceiling.`
                                        : state.alt < 50
                                            ? `Current altitude ${state.alt.toFixed(0)} m. Low altitude — collision risk elevated.`
                                            : `Current altitude ${state.alt.toFixed(0)} m. Optimal flight band.`)}
                                    {selectedMetric === 'stab' && (state.stab < 0.82
                                        ? `Wing stability index ${state.stab.toFixed(3)}. Degraded — possible mechanical or environmental cause.`
                                        : `Wing stability index ${state.stab.toFixed(3)}. Nominal aerodynamic performance.`)}
                                    {selectedMetric === 'gps' && (state.gps < 0.5
                                        ? `GPS signal strength ${state.gps.toFixed(3)}. Reduced accuracy — position hold unreliable.`
                                        : `GPS signal strength ${state.gps.toFixed(3)}. Strong signal — full navigation available.`)}
                                    {selectedMetric === 'temp' && (state.temp > 45
                                        ? `System temperature ${state.temp.toFixed(0)}°C. Elevated — thermal throttling may activate.`
                                        : `System temperature ${state.temp.toFixed(0)}°C. Within operational thermal limits.`)}
                                </div>
                            </div>
                            <div className="modal-section">
                                <div className="modal-section-title">LAST {HISTORY_LEN}s HISTORY</div>
                                <div style={{ padding: '8px 0 4px' }}>
                                    {selectedMetric === 'battery' && <TelemetryChart values={history.battery} color="var(--green)" warnVal={20} critVal={10} maxVal={100} unit="%" />}
                                    {selectedMetric === 'wind'    && <TelemetryChart values={history.wind}    color="var(--blue)"  warnVal={16} critVal={24} maxVal={35}  unit="m/s" />}
                                    {selectedMetric === 'alt'     && <TelemetryChart values={history.alt}     color="var(--blue)"  maxVal={150} minVal={0}   unit="m" />}
                                    {selectedMetric === 'stab'    && <TelemetryChart values={history.stab}    color="var(--green)" warnVal={0.82} critVal={0.62} maxVal={1} minVal={0} unit="" />}
                                    {selectedMetric === 'gps'     && <TelemetryChart values={history.gps}     color="var(--green)" warnVal={0.5}  critVal={0.25} maxVal={1} minVal={0} unit="" />}
                                    {selectedMetric === 'temp'    && <TelemetryChart values={history.temp}    color="var(--amber)" warnVal={45}  critVal={55}  maxVal={80}  unit="°C" />}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* AGENT DETAIL MODAL */}
            {selectedCard && (
                <div
                    className="modal-overlay"
                    onClick={(e) => e.target === e.currentTarget && setSelectedCard(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="modal-title"
                >
                    <div className="modal">
                        <div className="modal-header">
                            <div>
                                <div className="modal-title" id="modal-title">{selectedCard.title}</div>
                                <div className="modal-sub">Risk score: {selectedCard.risk.toFixed(3)} · {new Date().toLocaleTimeString()}</div>
                            </div>
                            <button type="button" className="modal-close" onClick={() => setSelectedCard(null)} aria-label="Close">✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="modal-section">
                                <div className="modal-section-title">AGENT ANALYSIS</div>
                                <div className="modal-text">{selectedCard.body}</div>
                            </div>
                            {selectedCard.issues.length > 0 && (
                                <div className="modal-section">
                                    <div className="modal-section-title">EVIDENCE FROM TELEMETRY</div>
                                    {selectedCard.issues.map((e) => (
                                        <div key={e.key} className="evidence-row">
                                            <span className="ev-metric">{e.key}</span>
                                            <span className="ev-val">{e.val}</span>
                                            <span className="ev-threshold">thresh: {e.threshold}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="modal-section">
                                <div className="modal-section-title">INTERVENTION PLAN</div>
                                {selectedCard.plan.map((p, i) => (
                                    <div key={i} className="plan-step">
                                        <span className="plan-num">{String(i + 1).padStart(2, '0')}</span>
                                        <span className="plan-text">{p.text}</span>
                                        <span className={`plan-priority pri-${p.pri}`}>{p.pri.toUpperCase()}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="modal-section">
                                <div className="modal-section-title">COMMAND DECISION</div>
                                <div className="cmd-action-row">
                                    <span className="cmd-icon">▶</span>
                                    <span className="cmd-text">{selectedCard.command}</span>
                                    <button type="button" className="cmd-execute-btn" onClick={() => executeCommand(selectedCard)}>EXECUTE</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}