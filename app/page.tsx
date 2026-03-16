"use client";

import React, { useEffect, useRef } from 'react';

export default function AFSMPage() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // ─── STATE ───────────────────────────────────────────────────────────────────
        let S = {
            battery: 78, wind: 6, alt: 95, stab: 0.96, gps: 0.95, temp: 32,
            risk: 0.08, scenario: null as string | null, tick: 0,
            x: 0, y: 0, vx: 1.2, vy: 0.4, heading: 0,
            startTime: Date.now(), totalEvents: 0,
            lastIssues: [] as any[]
        };
        let logEntries: any[] = [];
        let flightPath: any[] = [];
        let agentCards: any[] = [];
        let lastDecisionTime = 0;

        // ─── RISK ENGINE ──────────────────────────────────────────────────────────────
        function computeRisk() {
            let r = 0, issues = [];
            if (S.battery < 8) { r += 0.5; issues.push({ key: 'BATTERY_CRITICAL', val: S.battery.toFixed(0) + '%', threshold: '10%', delta: '+' + ((10 - S.battery).toFixed(1)) + '%' }); }
            else if (S.battery < 20) { r += 0.28; issues.push({ key: 'BATTERY_LOW', val: S.battery.toFixed(0) + '%', threshold: '20%', delta: '+' + ((20 - S.battery).toFixed(1)) + '%' }); }
            if (S.wind > 24) { r += 0.38; issues.push({ key: 'WIND_CRITICAL', val: S.wind.toFixed(1) + 'm/s', threshold: '24m/s', delta: '+' + (S.wind - 24).toFixed(1) }); }
            else if (S.wind > 16) { r += 0.22; issues.push({ key: 'HIGH_WIND', val: S.wind.toFixed(1) + 'm/s', threshold: '16m/s', delta: '+' + (S.wind - 16).toFixed(1) }); }
            if (S.stab < 0.62) { r += 0.35; issues.push({ key: 'WING_INSTABILITY', val: S.stab.toFixed(2), threshold: '0.75', delta: (S.stab - 0.75).toFixed(2) }); }
            else if (S.stab < 0.82) { r += 0.18; issues.push({ key: 'REDUCED_STABILITY', val: S.stab.toFixed(2), threshold: '0.82', delta: (S.stab - 0.82).toFixed(2) }); }
            if (S.gps < 0.25) { r += 0.28; issues.push({ key: 'GPS_SIGNAL_LOSS', val: S.gps.toFixed(2), threshold: '0.40', delta: (S.gps - 0.40).toFixed(2) }); }
            if (S.temp > 52) { r += 0.15; issues.push({ key: 'THERMAL_WARNING', val: S.temp.toFixed(0) + '°C', threshold: '50°C', delta: '+' + ((S.temp - 50).toFixed(0)) + '°' }); }
            S.lastIssues = issues;
            return Math.min(1, Math.max(0, r + (Math.random() * 0.015 - 0.0075)));
        }

        // ─── NEMOTRON INTEGRATION ───────────────────────────────────────────────────
        async function requestNemotronDecision(trigger: string) {
            const now = Date.now();
            if (now - lastDecisionTime < 2500) return;
            lastDecisionTime = now;

            addLog('cmd', 'agent', `Requesting Nemotron analysis (trigger: ${trigger})...`);

            try {
                const response = await fetch('/api/decision', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telemetry: {
                            battery: S.battery,
                            wind: S.wind,
                            alt: S.alt,
                            stab: S.stab,
                            gps: S.gps,
                            temp: S.temp,
                            risk: S.risk
                        },
                        issues: S.lastIssues,
                        trigger: trigger
                    })
                });

                if (!response.ok) throw new Error('Failed to get decision');
                const decision = await response.json();

                // Safety for triggered_rules
                const rules = Array.isArray(decision.triggered_rules) ? decision.triggered_rules : [];

                const card = {
                    severity: decision.safety_state === 'CRITICAL' ? 'crit' : decision.safety_state === 'WARNING' ? 'warn' : 'ok',
                    title: decision.recommended_action.replace(/_/g, ' '),
                    body: decision.reasoning_bullets.join('. '),
                    plan: decision.reasoning_bullets.map((b: string) => ({ text: b, pri: decision.safety_state === 'CRITICAL' ? 'high' : 'med' })),
                    command: decision.command,
                    issues: rules.map((r: any) => ({ key: r.rule_id, val: r.value, threshold: r.threshold, delta: 'N/A' })),
                    risk: decision.risk_score,
                    ts: Date.now()
                };

                if (card.severity !== 'ok') {
                    agentCards.push(card);
                    if (agentCards.length > 20) agentCards.shift();
                    renderAgentPanel();
                    addLog(card.severity === 'crit' ? 'crit' : 'warn', 'agent', `Nemotron Decision: ${card.title} - ${card.command}`);
                } else {
                    addLog('ok', 'agent', `Nemotron analysis: NOMINAL decision received. All systems clear.`);
                }

            } catch (error) {
                addLog('warn', 'agent', 'Nemotron request failed. Using local rule-based fallback.');
            }
        }

        // ─── RENDER AGENT PANEL ────────────────────────────────────────────────────────
        function renderAgentPanel() {
            const sec = document.getElementById('agent-section');
            if (!sec) return;
            if (agentCards.length === 0) {
                sec.innerHTML = `<div style="padding:20px 12px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-dim)">Agent monitoring...<br><br><div class="pulse-dot" style="margin:0 auto"></div></div>`;
                return;
            }
            sec.innerHTML = agentCards.slice(-4).reverse().map((c, i) => `
        <div class="agent-card ${c.severity}" id="agent-card-${i}">
          <div class="agent-card-header">
            <span class="agent-card-icon">${c.severity === 'crit' ? '⚠' : '▲'}</span>
            <span class="agent-card-title">${c.title}</span>
            <span class="agent-card-score ${c.severity === 'crit' ? 'score-crit' : c.severity === 'warn' ? 'score-warn' : 'score-ok'}">${c.risk.toFixed(2)}</span>
          </div>
          <div class="agent-card-body">
            ${c.body}
            <div class="evidence">${c.issues.length ? c.issues.map((e: any) => `<span>${e.key}: </span><span>${e.val}</span>`).join(' · ') : 'No violations'}</div>
          </div>
          <div class="cmd-block">
            <div class="cmd-label">DECISION</div>
            ${c.command}
          </div>
        </div>
      `).join('');

            agentCards.slice(-4).reverse().forEach((c, i) => {
                const el = document.getElementById(`agent-card-${i}`);
                if (el) el.onclick = () => openAgentModal(agentCards.length - 1 - i);
            });
        }

        // ─── LOG SYSTEM ───────────────────────────────────────────────────────────────
        function kw(text: string) {
            if (!text) return "";
            return text
                .replace(/\b(RETURN_TO_HOME|EMERGENCY_DESCENT|EMERGENCY_LAND|ADVISORY|STABILIZE|CONTINUE|DIVERT)\b/g, '<span class="kw-cmd">$1</span>')
                .replace(/\b(CRITICAL|FAILURE|COMPROMISED|LOSS|FAULT)\b/g, '<span class="kw-crit">$1</span>')
                .replace(/\b(WARNING|ELEVATED|REDUCED|HIGH|EXCEEDED)\b/g, '<span class="kw-warn">$1</span>')
                .replace(/\b(\d+\.?\d*\s*(?:m\/s|%|°C|m))\b/g, '<span class="kw-val">$1</span>')
                .replace(/\b(Agent|Supervisor|Battery Agent|Wind Agent|Stability Agent|GPS Agent|Nemotron)\b/g, '<span class="kw-agent">$1</span>');
        }

        function addLog(type: string, badge: string, msg: string) {
            const now = new Date();
            const t = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).slice(0, 1)}`;
            logEntries.unshift({ type, badge, msg: kw(msg), t });
            if (logEntries.length > 120) logEntries.pop();
            S.totalEvents++;
            const evac = document.getElementById('hdr-events');
            if (evac) evac.textContent = String(S.totalEvents);
            renderLog();
        }

        function renderLog() {
            const body = document.getElementById('log-body');
            if (!body) return;
            body.innerHTML = logEntries.slice(0, 50).map(e => `
        <div class="log-entry ${e.type}">
          <span class="log-time">${e.t}</span>
          <span class="log-badge badge-${e.badge}">${e.badge.toUpperCase()}</span>
          <span class="log-msg">${e.msg}</span>
        </div>
      `).join('');
            const countEl = document.getElementById('log-count');
            if (countEl) countEl.textContent = logEntries.length + ' entries';
        }

        // ─── MODAL SYSTEM ─────────────────────────────────────────────────────────────
        function openAgentModal(idx: number) {
            const c = agentCards[idx];
            if (!c) return;
            const overlay = document.getElementById('modal-overlay');
            if (!overlay) return;

            const titleEl = document.getElementById('modal-title');
            if (titleEl) titleEl.textContent = c.title;

            const bodyEl = document.getElementById('modal-body');
            if (bodyEl) bodyEl.innerHTML = `
        <div class="modal-section">
          <div class="modal-section-title">Evidence</div>
          <div class="modal-text">${c.body}</div>
        </div>
        <div class="modal-section">
          <div class="modal-section-title">Intervention Plan</div>
          ${c.plan.map((p: any, i: number) => `
            <div class="plan-step" style="display:flex;gap:10px;padding:5px 0;font-size:11px;">
              <span style="color:var(--blue)">0${i + 1}</span>
              <span style="flex:1">${p.text}</span>
            </div>
          `).join('')}
        </div>
        <div class="modal-section">
          <div class="cmd-action-row" style="background:var(--bg);padding:10px;border:1px solid var(--blue-dim);display:flex;justify-content:space-between;align-items:center;">
            <span style="color:var(--blue);font-family:var(--mono);font-size:10px;">${c.command}</span>
            <button class="cmd-execute-btn" id="modal-execute-btn">EXECUTE</button>
          </div>
        </div>
      `;

            const execBtn = document.getElementById('modal-execute-btn');
            if (execBtn) execBtn.onclick = () => {
                executeCmd(c.command);
                overlay.classList.remove('active');
            };

            overlay.classList.add('active');
        }

        function executeCmd(cmd: string) {
            addLog('cmd', 'cmd', 'Operator executed: ' + cmd);
            // Trigger a new decision following the command execution
            requestNemotronDecision('COMMAND_EXECUTED');
        }

        function inject(type: string) {
            if (type === 'wind') { S.wind = 26; S.scenario = 'wind'; }
            else if (type === 'bird') { S.stab = 0.55; S.scenario = 'bird'; }
            else if (type === 'battery') { S.battery = 8; S.scenario = 'battery'; }
            else if (type === 'gps') { S.gps = 0.15; S.scenario = 'gps'; }
            else if (type === 'turbulence') { S.stab -= 0.1; S.wind += 10; S.scenario = 'turbulence'; }
            else if (type === 'engine') { S.temp = 60; S.scenario = 'engine'; S.stab -= 0.1; }
            else if (type === 'reset') {
                Object.assign(S, { battery: 78, wind: 6, alt: 95, stab: 0.96, gps: 0.95, temp: 32, scenario: null, lastIssues: [] });
                agentCards = [];
                renderAgentPanel();
                addLog('ok', 'ok', 'Resetting all systems...');
                return;
            }
            addLog('warn', 'warn', `Injecting disturbance: ${type.toUpperCase()}`);
            requestNemotronDecision(`INJECT_${type.toUpperCase()}`);
        }

        function updateHUD() {
            const setM = (id: string, val: string, pct: number, col: string) => {
                const vel = document.getElementById('mv-' + id);
                if (vel) vel.innerHTML = val;
                const fel = document.getElementById('mf-' + id);
                if (fel) { fel.style.width = Math.min(100, Math.max(0, pct)) + '%'; fel.style.background = col; }
            };

            setM('battery', Math.round(S.battery) + '%', S.battery, S.battery < 20 ? 'var(--red)' : 'var(--green)');
            setM('wind', S.wind.toFixed(1) + ' m/s', (S.wind / 30) * 100, S.wind > 20 ? 'var(--red)' : 'var(--green)');
            setM('alt', Math.round(S.alt) + 'm', (S.alt / 150) * 100, 'var(--blue)');
            setM('stab', S.stab.toFixed(2), S.stab * 100, S.stab < 0.7 ? 'var(--red)' : 'var(--green)');
            setM('gps', S.gps.toFixed(2), S.gps * 100, S.gps < 0.4 ? 'var(--red)' : 'var(--green)');
            setM('temp', Math.round(S.temp) + '°C', (S.temp / 80) * 100, S.temp > 50 ? 'var(--red)' : 'var(--amber)');

            const r = S.risk;
            const riskEl = document.getElementById('risk-big');
            if (riskEl) {
                riskEl.textContent = r.toFixed(2);
                riskEl.style.color = r > 0.7 ? 'var(--red)' : r > 0.4 ? 'var(--amber)' : 'var(--green)';
            }
            const ptr = document.getElementById('risk-ptr');
            if (ptr) ptr.style.left = Math.min(95, Math.max(5, (r * 100))) + '%';

            const hstat = document.getElementById('hdr-status');
            if (hstat) {
                hstat.textContent = r > 0.7 ? 'CRITICAL' : r > 0.4 ? 'WARNING' : 'NOMINAL';
                hstat.style.color = r > 0.7 ? 'var(--red)' : r > 0.4 ? 'var(--amber)' : 'var(--green)';
            }

            const sec = Math.floor((Date.now() - S.startTime) / 1000);
            const m = String(Math.floor(sec / 60)).padStart(2, '0');
            const s = String(sec % 60).padStart(2, '0');
            const timeEl = document.getElementById('hdr-time');
            if (timeEl) timeEl.textContent = m + ':' + s;
        }

        const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
        const mainCtx = mainCanvas?.getContext('2d');
        const flightCanvas = document.getElementById('flightCanvas') as HTMLCanvasElement;
        const flightCtx = flightCanvas?.getContext('2d');

        function draw() {
            if (mainCtx && mainCanvas) {
                const w = mainCanvas.width, h = mainCanvas.height;
                mainCtx.fillStyle = '#080c10';
                mainCtx.fillRect(0, 0, w, h);
                mainCtx.strokeStyle = 'rgba(0,255,180,0.1)';
                for (let i = 0; i < w; i += 40) { mainCtx.beginPath(); mainCtx.moveTo(i, 0); mainCtx.lineTo(i, h); mainCtx.stroke(); }
                for (let i = 0; i < h; i += 40) { mainCtx.beginPath(); mainCtx.moveTo(0, i); mainCtx.lineTo(w, i); mainCtx.stroke(); }

                mainCtx.fillStyle = S.risk > 0.7 ? 'var(--red)' : 'var(--green)';
                mainCtx.beginPath();
                S.x = w / 2 + Math.sin(S.tick * 0.05) * 100;
                S.y = h / 2 + Math.cos(S.tick * 0.03) * 50;
                mainCtx.arc(S.x, S.y, 10, 0, Math.PI * 2);
                mainCtx.fill();
            }
            if (flightCtx && flightCanvas) {
                const w = flightCanvas.width, h = flightCanvas.height;
                flightCtx.fillStyle = '#131a21';
                flightCtx.fillRect(0, 0, w, h);
                flightPath.push({ x: w / 2 + Math.sin(S.tick * 0.02) * 60, y: h / 2 + Math.cos(S.tick * 0.01) * 40 });
                if (flightPath.length > 100) flightPath.shift();
                flightCtx.strokeStyle = 'var(--green)';
                flightCtx.beginPath();
                flightPath.forEach((p, i) => { if (i === 0) flightCtx.moveTo(p.x, p.y); else flightCtx.lineTo(p.x, p.y); });
                flightCtx.stroke();
            }
        }

        function tickTelemetry() {
            S.tick++;
            if (!S.scenario) {
                S.battery = Math.max(5, S.battery - 0.05);
                S.wind = 6 + Math.sin(S.tick * 0.1) * 3;
                S.alt = 90 + Math.sin(S.tick * 0.05) * 10;
            }
            const prevRisk = S.risk;
            S.risk = computeRisk();
            // Threshold Crossing triggers
            if ((prevRisk < 0.4 && S.risk >= 0.4) || (prevRisk < 0.78 && S.risk >= 0.78)) {
                requestNemotronDecision('THRESHOLD_CROSSING');
            }
            updateHUD();
        }

        const interval = setInterval(() => { tickTelemetry(); draw(); }, 100);

        // Wire UI
        const btns = document.querySelectorAll('.trigger-btn');
        const types = ['wind', 'bird', 'battery', 'gps', 'turbulence', 'engine'];
        btns.forEach((b: any, i) => b.onclick = () => inject(types[i]));
        const rst = document.querySelector('.trigger-reset') as any;
        if (rst) rst.onclick = () => inject('reset');

        const mc = document.querySelectorAll('.metric-card');
        const mtypes = ['battery', 'wind', 'alt', 'stab', 'gps', 'temp'];
        mc.forEach((m: any, i) => m.onclick = () => alert(`Viewing ${mtypes[i]} history`));

        return () => clearInterval(interval);
    }, []);

    return (
        <>
            <style dangerouslySetInnerHTML={{
                __html: `
        :root {
          --bg: #080c10; --bg2: #0d1318; --bg3: #131a21;
          --border: rgba(0,255,180,0.12); --border2: rgba(0,255,180,0.22);
          --green: #00ffb4; --green-dim: rgba(0,255,180,0.15);
          --amber: #ffb700; --amber-dim: rgba(255,183,0,0.15);
          --red: #ff4444; --red-dim: rgba(255,68,68,0.15);
          --blue: #4db8ff; --blue-dim: rgba(77,184,255,0.12);
          --text: #c8d8e8; --text-dim: #5a7080; --text-bright: #e8f4ff;
          --mono: 'IBM Plex Mono', monospace; --sans: 'IBM Plex Sans', sans-serif;
        }
        body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 13px; margin: 0; overflow: hidden; }
        body::before { content: ''; position: fixed; inset: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px); pointer-events: none; z-index: 1000; }
        .layout { display: grid; grid-template-columns: 260px 1fr 300px; grid-template-rows: 48px 1fr; height: 100vh; }
        .header { grid-column: 1 / -1; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 16px; }
        .header-logo { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--green); letter-spacing: 0.15em; }
        .header-stat { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 10px; color: var(--text-dim); padding: 0 12px; border-left: 1px solid var(--border); }
        .header-stat .val { color: var(--green); }
        .left-panel, .right-panel { background: var(--bg2); border: 1px solid var(--border); display: flex; flex-direction: column; }
        .left-panel { border-right-width: 1px; border-right-style: solid; }
        .right-panel { border-left-width: 1px; border-left-style: solid; }
        .panel-header { font-family: var(--mono); font-size: 9px; padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-dim); }
        .metrics-section { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; border-bottom: 1px solid var(--border); }
        .metric-card { background: var(--bg3); border: 1px solid var(--border); padding: 8px; border-radius: 4px; cursor: pointer; }
        .metric-label { font-size: 8px; text-transform: uppercase; color: var(--text-dim); }
        .metric-value { font-family: var(--mono); font-size: 16px; color: var(--text-bright); }
        .metric-bar { height: 2px; background: var(--border); margin-top: 5px; }
        .metric-fill { height: 100%; transition: width 0.3s; }
        .risk-section { padding: 15px; border-bottom: 1px solid var(--border); }
        .risk-score-big { font-family: var(--mono); font-size: 32px; font-weight: 500; }
        .risk-bar-track { height: 4px; background: linear-gradient(to right, #00ffb4, #ffb700, #ff4444); position: relative; margin-top: 8px; }
        .risk-pointer { position: absolute; top: -3px; width: 10px; height: 10px; border-radius: 50%; background: #fff; border: 2px solid var(--bg); transform: translateX(-50%); }
        .trigger-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 10px; }
        .trigger-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 7px; font-size: 9px; cursor: pointer; text-align: left; }
        .trigger-reset { width: calc(100% - 20px); margin: 0 10px 10px 10px; border: 1px solid var(--border); background: transparent; color: var(--text-dim); padding: 6px; font-size: 9px; cursor: pointer; }
        .flight-view { flex: 1; background: #000; position: relative; }
        canvas { width: 100%; height: 100%; display: block; }
        .log-section { height: 200px; display: flex; flex-direction: column; background: var(--bg2); border-top: 1px solid var(--border); }
        .log-body { flex: 1; overflow-y: auto; padding: 10px; font-family: var(--mono); font-size: 10px; }
        .agent-section { flex: 1; overflow-y: auto; padding: 5px; }
        .agent-card { background: var(--bg3); border: 1px solid var(--border); margin: 5px; padding: 10px; border-radius: 4px; cursor: pointer; }
        .agent-card.crit { border-color: var(--red); }
        .agent-card.warn { border-color: var(--amber); }
        .agent-card-header { display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 5px; font-family: var(--mono); }
        .agent-card-body { font-size: 11px; line-height: 1.4; }
        .cmd-block { background: var(--bg); margin-top: 8px; padding: 6px; font-family: var(--mono); font-size: 9px; color: var(--blue); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 2000; }
        .modal-overlay.active { display: flex; }
        .modal { background: var(--bg2); border: 1px solid var(--border2); width: 450px; padding: 20px; color: var(--text); }
        .modal-header { display: flex; justify-content: space-between; margin-bottom: 15px; }
        .cmd-execute-btn { background: var(--blue); color: #000; border: none; padding: 5px 15px; cursor: pointer; font-weight: 600; font-size: 10px; }
        .pulse-dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; }
      ` }} />

            <div className="layout">
                <header className="header">
                    <span className="header-logo">AFSM v2.2</span>
                    <div style={{ flex: 1 }}></div>
                    <div className="header-stat"><div id="hdr-dot" className="pulse-dot"></div><span>STATUS</span><span id="hdr-status" className="val" style={{ marginLeft: 5 }}>NOMINAL</span></div>
                    <div className="header-stat"><span>UPTIME</span><span id="hdr-time" className="val" style={{ marginLeft: 5 }}>00:00</span></div>
                    <div className="header-stat"><span>EVENTS</span><span id="hdr-events" className="val" style={{ marginLeft: 5 }}>0</span></div>
                </header>

                <div className="left-panel">
                    <div className="panel-header">TELEMETRY</div>
                    <div className="metrics-section">
                        <div className="metric-card" id="mc-battery"><div className="metric-label">Battery</div><div className="metric-value" id="mv-battery">78%</div><div className="metric-bar"><div className="metric-fill" id="mf-battery"></div></div></div>
                        <div className="metric-card" id="mc-wind"><div className="metric-label">Wind</div><div className="metric-value" id="mv-wind">6.0 m/s</div><div className="metric-bar"><div className="metric-fill" id="mf-wind"></div></div></div>
                        <div className="metric-card" id="mc-alt"><div className="metric-label">Altitude</div><div className="metric-value" id="mv-alt">95m</div><div className="metric-bar"><div className="metric-fill" id="mf-alt"></div></div></div>
                        <div className="metric-card" id="mc-stab"><div className="metric-label">Stability</div><div className="metric-value" id="mv-stab">0.96</div><div className="metric-bar"><div className="metric-fill" id="mf-stab"></div></div></div>
                    </div>
                    <div className="risk-section"><div className="risk-score-big" id="risk-big">0.08</div><div className="risk-bar-track"><div className="risk-pointer" id="risk-ptr"></div></div></div>
                    <div className="trigger-grid"><button className="trigger-btn">Wind Spike</button><button className="trigger-btn">Bird Strike</button><button className="trigger-btn">Batt Drop</button><button className="trigger-btn">GPS Jam</button><button className="trigger-btn">Turbulence</button><button className="trigger-btn">Engine Vibe</button></div>
                    <button className="trigger-reset">RESET SYSTEMS</button>
                    <div className="panel-header">FLIGHT PATH</div>
                    <div style={{ flex: 1, padding: 10 }}><canvas id="flightCanvas"></canvas></div>
                </div>

                <div className="center-panel">
                    <div className="flight-view"><canvas id="mainCanvas"></canvas></div>
                    <div className="log-section">
                        <div className="panel-header">DECISION LOG</div>
                        <div className="log-body" id="log-body"></div>
                    </div>
                </div>

                <div className="right-panel">
                    <div className="panel-header" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>NEMOTRON SAFETY AGENT</span>
                        <span style={{ fontSize: '7px', color: 'var(--green-dim)', letterSpacing: '0.05em' }}>MODEL: nvidia nemotron nano 9b v2</span>
                    </div>
                    <div className="agent-section" id="agent-section"></div>
                </div>
            </div>

            <div className="modal-overlay" id="modal-overlay">
                <div className="modal"><div className="modal-header"><div id="modal-title" style={{ fontWeight: 600 }}>Analysis</div><button className="modal-close" style={{ background: 0, border: 0, color: '#fff', cursor: 'pointer' }}>✕</button></div><div id="modal-body"></div></div>
            </div>
        </>
    );
}
