import { NextResponse } from 'next/server';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nvidia-nemotron-nano-9b-v2';

const SYSTEM_PROMPT = `
You are the Autonomous Flight Safety Monitor (AFSM) agent. Your task is to analyze drone telemetry and issue safety decisions in strict JSON format.

SAFETY RULES:
- Battery: WARNING if < 20%, CRITICAL if < 10%
- Wind: WARNING if > 16 m/s, CRITICAL if > 24 m/s
- Stability: WARNING if < 0.82, CRITICAL if < 0.62
- GPS Signal: WARNING if < 0.50, CRITICAL if < 0.25
- Temperature: WARNING if > 45C, CRITICAL if > 55C

HARD REQUIREMENTS:
- If battery is CRITICAL AND GPS is CRITICAL, recommended_action MUST be "EMERGENCY_LAND"
- If wind is CRITICAL AND altitude > 60m, recommended_action MUST be "EMERGENCY_DESCENT"

You must return a JSON object with this schema:
{
  "agent": "safety_monitor",
  "safety_state": "NOMINAL|WARNING|CRITICAL",
  "risk_score": float (0.0 to 1.0),
  "confidence": float (0.0 to 1.0),
  "triggered_rules": [{"rule_id": "string", "value": "string", "threshold": "string"}],
  "recommended_action": "CONTINUE|RETURN_TO_HOME|DIVERT|EMERGENCY_LAND|EMERGENCY_DESCENT",
  "target": {"alt_m": number, "landing_zone": "string", "home": boolean},
  "reasoning_bullets": ["string", "string", "string"],
  "command": "string (MUST start with 'CMD: ', e.g., 'CMD: RETURN_TO_HOME')",
  "next_check_seconds": number
}

Return ONLY the JSON object. No markdown, no code fences, no explanation — just the raw JSON.
`;

function safeJsonParse(text: string) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch {}
        }
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

    if (raw.agent !== 'safety_monitor') return null;
    if (!states.has(raw.safety_state)) return null;
    if (!actions.has(raw.recommended_action)) return null;
    if (!Array.isArray(raw.reasoning_bullets) || raw.reasoning_bullets.length < 1) return null;

    let command = typeof raw.command === 'string' ? raw.command : '';
    if (command && !command.startsWith('CMD:')) {
        command = 'CMD: ' + command;
    }
    if (!command.startsWith('CMD:')) return null;

    const triggered = Array.isArray(raw.triggered_rules) ? raw.triggered_rules : [];

    return {
        agent: 'safety_monitor' as const,
        safety_state: raw.safety_state as 'NOMINAL' | 'WARNING' | 'CRITICAL',
        risk_score: clamp01(Number(raw.risk_score)),
        confidence: clamp01(Number(raw.confidence)),
        triggered_rules: triggered
            .filter((r: any) => r && typeof r === 'object')
            .map((r: any) => ({
                rule_id: String(r.rule_id ?? 'RULE'),
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
        command,
        next_check_seconds: Math.max(2, Math.min(30, Number(raw.next_check_seconds ?? 5))),
    };
}

async function callNvidia(payload: any) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: NVIDIA_MODEL,
                temperature: 0.6,
                top_p: 0.95,
                max_tokens: 2048,
                frequency_penalty: 0,
                presence_penalty: 0,
                // stream must be false — streaming requires a different response handler
                stream: false,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `Current Telemetry: ${JSON.stringify(payload.telemetry)}\nIssues Detected: ${JSON.stringify(payload.issues)}\nTrigger Event: ${payload.trigger}\n\nRespond with only a JSON object matching the schema above.`,
                    },
                ],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`NVIDIA API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        // The thinking model returns reasoning_content separately from content.
        // We only want the final content (the JSON), not the thinking tokens.
        const message = data.choices?.[0]?.message;
        const content: string = message?.content ?? message?.reasoning_content ?? '';

        if (!content) {
            console.error('Empty content from NVIDIA API. Full response:', JSON.stringify(data));
            return null;
        }

        const parsed = safeJsonParse(content);
        if (!parsed) console.error('JSON parse failed. Raw content:', content);
        return parsed;
    } finally {
        clearTimeout(timeout);
    }
}

export async function POST(request: Request) {
    try {
        const payload = await request.json();

        if (!NVIDIA_API_KEY) {
            return NextResponse.json({ error: 'NVIDIA_API_KEY not configured' }, { status: 500 });
        }

        let decision: any = null;

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const raw = await callNvidia(payload);
                decision = normalizeDecision(raw);
                if (decision) break;
                console.error(`Attempt ${attempt + 1}: normalizeDecision returned null, raw was:`, raw);
            } catch (e) {
                console.error(`Attempt ${attempt + 1} failed:`, e);
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
        console.error('API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}