import { NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2';

const SYSTEM_PROMPT = `
You are the Autonomous Flight Safety Monitor (AFSM) agent.
Analyze drone telemetry and issue safety decisions.
You MUST respond with ONLY a valid JSON object. No markdown, no backticks, no extra text.

SAFETY RULES:
- Battery: WARNING if < 20%, CRITICAL if < 10%
- Wind: WARNING if > 16 m/s, CRITICAL if > 24 m/s
- Stability: WARNING if < 0.82, CRITICAL if < 0.62
- GPS Signal: WARNING if < 0.50, CRITICAL if < 0.25
- Temperature: WARNING if > 45C, CRITICAL if > 55C

HARD REQUIREMENTS:
- If battery is CRITICAL AND GPS is CRITICAL, recommended_action MUST be "EMERGENCY_LAND"
- If wind is CRITICAL AND altitude > 60m, recommended_action MUST be "EMERGENCY_DESCENT"

RESPONSE JSON SCHEMA (respond with ONLY this JSON, nothing else):
{
  "agent": "safety_monitor",
  "safety_state": "NOMINAL" or "WARNING" or "CRITICAL",
  "risk_score": number between 0 and 1,
  "confidence": number between 0 and 1,
  "triggered_rules": [{"rule_id": "string", "value": "string", "threshold": "string"}],
  "recommended_action": "CONTINUE" or "RETURN_TO_HOME" or "DIVERT" or "EMERGENCY_LAND" or "EMERGENCY_DESCENT",
  "target": {"alt_m": number, "landing_zone": "string", "home": boolean},
  "reasoning_bullets": ["string", "string"],
  "command": "CMD: your_command_here",
  "next_check_seconds": 5
}
`.trim();

/**
 * Extract the first valid JSON object from a string that may contain
 * extra text, whitespace, markdown fences, etc.
 */
function extractJson(text: string | null | undefined): any {
    if (!text) return null;

    // Strip markdown code fences
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch { /* continue */ }

    // Try to find first { ... } block using brace matching
    const start = cleaned.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') depth--;
        if (depth === 0) {
            try {
                return JSON.parse(cleaned.slice(start, i + 1));
            } catch {
                return null;
            }
        }
    }

    // Brace never closed — try to auto-close truncated JSON
    const partial = cleaned.slice(start);
    // Count unclosed braces and brackets
    let braces = 0, brackets = 0;
    for (const ch of partial) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
    }
    let attempt = partial;
    while (brackets > 0) { attempt += ']'; brackets--; }
    while (braces > 0) { attempt += '}'; braces--; }
    try {
        return JSON.parse(attempt);
    } catch {
        return null;
    }
}

function clamp01(x: number) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
}

function normalizeDecision(raw: any) {
    if (!raw || typeof raw !== 'object') return null;

    const states = new Set(['NOMINAL', 'WARNING', 'CRITICAL']);
    const actions = new Set(['CONTINUE', 'RETURN_TO_HOME', 'DIVERT', 'EMERGENCY_LAND', 'EMERGENCY_DESCENT']);

    // Auto-fix: allow "agent" to be missing or different
    // (some models might omit it), but prefer it to be correct
    if (raw.agent && raw.agent !== 'safety_monitor') {
        raw.agent = 'safety_monitor';
    }
    if (!raw.agent) raw.agent = 'safety_monitor';

    // Auto-fix: uppercase safety_state
    if (typeof raw.safety_state === 'string') {
        raw.safety_state = raw.safety_state.toUpperCase();
    }
    if (!states.has(raw.safety_state)) return null;

    // Auto-fix: uppercase recommended_action and normalize
    if (typeof raw.recommended_action === 'string') {
        raw.recommended_action = raw.recommended_action.toUpperCase().replace(/\s+/g, '_');
    }
    if (!actions.has(raw.recommended_action)) return null;

    // Auto-fix: reasoning_bullets
    if (!Array.isArray(raw.reasoning_bullets)) {
        if (typeof raw.reasoning === 'string') {
            raw.reasoning_bullets = [raw.reasoning];
        } else {
            raw.reasoning_bullets = ['Safety analysis performed'];
        }
    }

    // Auto-fix: command must start with CMD:
    let command = typeof raw.command === 'string' ? raw.command.trim() : '';
    if (!command) {
        command = `CMD: ${raw.recommended_action}`;
    }
    if (!command.startsWith('CMD:') && !command.startsWith('CMD ')) {
        command = 'CMD: ' + command;
    }

    const triggered = Array.isArray(raw.triggered_rules) ? raw.triggered_rules : [];

    const decision = {
        agent: 'safety_monitor' as const,
        safety_state: raw.safety_state as 'NOMINAL' | 'WARNING' | 'CRITICAL',
        risk_score: clamp01(Number(raw.risk_score ?? 0)),
        confidence: clamp01(Number(raw.confidence ?? 0.5)),
        triggered_rules: triggered
            .filter((r: any) => r && typeof r === 'object')
            .map((r: any) => ({
                rule_id: String(r.rule_id ?? r.id ?? 'RULE'),
                value: String(r.value ?? ''),
                threshold: String(r.threshold ?? ''),
            })),
        recommended_action: raw.recommended_action as any,
        target: raw.target && typeof raw.target === 'object'
            ? {
                alt_m: Number.isFinite(Number(raw.target.alt_m)) ? Number(raw.target.alt_m) : undefined,
                landing_zone: typeof raw.target.landing_zone === 'string' ? raw.target.landing_zone : undefined,
                home: typeof raw.target.home === 'boolean' ? raw.target.home : undefined,
            }
            : { alt_m: undefined, landing_zone: undefined, home: undefined },
        reasoning_bullets: raw.reasoning_bullets.map((x: any) => String(x)).slice(0, 5),
        command: command,
        next_check_seconds: Math.max(2, Math.min(30, Number(raw.next_check_seconds ?? 5))),
    };

    return decision;
}

async function callOpenRouter(payload: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        console.log(`[AFSM] Calling OpenRouter model=${OPENROUTER_MODEL}`);

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/alex-p-gates/afsm-monitor',
                'X-Title': 'AFSM Monitor',
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                temperature: 0.2,
                max_tokens: 800,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `Current Telemetry: ${JSON.stringify(payload.telemetry)}\nIssues Detected: ${JSON.stringify(payload.issues)}\nTrigger Event: ${payload.trigger}`
                    }
                ]
            }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AFSM] OpenRouter HTTP ${response.status}: ${errorText.slice(0, 300)}`);
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const rawBody = await response.text();
        // The response body sometimes has leading whitespace — trim it
        const trimmedBody = rawBody.trim();
        console.log(`[AFSM] Response length=${trimmedBody.length}, first 120 chars: ${JSON.stringify(trimmedBody.slice(0, 120))}`);

        let data;
        try {
            data = JSON.parse(trimmedBody);
        } catch {
            console.error(`[AFSM] Failed to parse outer response JSON`);
            return null;
        }

        if (data.error) {
            console.error(`[AFSM] OpenRouter error in body: ${JSON.stringify(data.error)}`);
            return null;
        }

        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            console.warn(`[AFSM] Model returned null/empty content. Full response: ${JSON.stringify(data).slice(0, 200)}`);
            return null;
        }

        console.log(`[AFSM] Model content (first 200): ${content.slice(0, 200)}`);
        const parsed = extractJson(content);
        if (!parsed) {
            console.error(`[AFSM] Failed to extract JSON from model content`);
        }
        return parsed;
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error(`[AFSM] Request timed out after 30s`);
        }
        throw err;
    }
}

export async function POST(request: Request) {
    try {
        const payload = await request.json();

        if (!OPENROUTER_API_KEY) {
            return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
        }

        let decision: any = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const raw = await callOpenRouter(payload);
                if (raw) {
                    console.log(`[AFSM] Attempt ${attempt + 1}: Got raw response, normalizing...`);
                    decision = normalizeDecision(raw);
                    if (decision) {
                        console.log(`[AFSM] ✓ Decision normalized successfully on attempt ${attempt + 1}`);
                        break;
                    } else {
                        console.warn(`[AFSM] Attempt ${attempt + 1}: Normalization failed. Raw keys: ${Object.keys(raw).join(',')}`);
                    }
                } else {
                    console.warn(`[AFSM] Attempt ${attempt + 1}: No parseable response from model`);
                }
            } catch (e: any) {
                console.error(`[AFSM] Attempt ${attempt + 1} failed: ${e.message}`);
            }
        }

        if (!decision) {
            return NextResponse.json(
                { error: 'Failed to get valid decision from AI' },
                { status: 502 }
            );
        }

        return NextResponse.json(decision);
    } catch (error: any) {
        console.error('[AFSM] API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
