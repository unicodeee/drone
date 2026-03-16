import { NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free';

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
  "command": "string",
  "next_check_seconds": number
}
`;

async function callOpenRouter(payload: any) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/alex-p-gates/afsm-monitor', // Required by OpenRouter
            'X-Title': 'AFSM Monitor',
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Current Telemetry: ${JSON.stringify(payload.telemetry)}\nIssues Detected: ${JSON.stringify(payload.issues)}\nTrigger Event: ${payload.trigger}` }
            ],
            response_format: { type: 'json_object' }
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
}

function validateDecision(decision: any): boolean {
    const requiredFields = ['agent', 'safety_state', 'risk_score', 'recommended_action', 'reasoning_bullets', 'command'];
    for (const field of requiredFields) {
        if (decision[field] === undefined) return false;
    }
    return true;
}

export async function POST(request: Request) {
    try {
        const payload = await request.json();

        if (!OPENROUTER_API_KEY) {
            return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
        }

        let decision;
        let attempts = 0;
        while (attempts < 2) {
            try {
                decision = await callOpenRouter(payload);
                if (validateDecision(decision)) {
                    break;
                }
            } catch (e) {
                console.error(`Attempt ${attempts + 1} failed:`, e);
            }
            attempts++;
        }

        if (!decision) {
            throw new Error('Failed to get valid decision from AI after retries');
        }

        return NextResponse.json(decision);
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
