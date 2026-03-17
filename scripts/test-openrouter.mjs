// scripts/test-openrouter.mjs
import fs from 'fs';
import path from 'path';

// Helper to load .env.local manually since we can't rely on dotenv being installed/runnable
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    });
}

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free';

if (!key) {
    console.error('Missing OPENROUTER_API_KEY in env');
    process.exit(1);
}

const SYSTEM_PROMPT = `
You are AFSM Safety Monitor Agent.
Return ONLY valid JSON. No extra text.

Schema:
{
  "agent":"safety_monitor",
  "safety_state":"NOMINAL|WARNING|CRITICAL",
  "risk_score":0.0,
  "confidence":0.0,
  "triggered_rules":[{"rule_id":"string","value":"string","threshold":"string"}],
  "recommended_action":"CONTINUE|RETURN_TO_HOME|DIVERT|EMERGENCY_LAND|EMERGENCY_DESCENT",
  "target":{"alt_m":0,"landing_zone":"string","home":false},
  "reasoning_bullets":["string","string","string"],
  "command":"string",
  "next_check_seconds":5
}

Hard rules:
- If battery is CRITICAL and GPS is CRITICAL -> EMERGENCY_LAND
- If wind is CRITICAL and altitude > 60 -> EMERGENCY_DESCENT

Constraints:
- command must start with "CMD:"
- reasoning_bullets length >= 2
- risk_score and confidence between 0 and 1
`.trim();

async function callCase(name, payload) {
    console.log(`\n=== CASE: ${name} ===`);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 450,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        }),
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();
    console.log('Full response data:', JSON.stringify(data, null, 2));
    const content = data?.choices?.[0]?.message?.content;
    console.log('Raw content:', content);

    try {
        const parsed = JSON.parse(content);
        console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));
    } catch (e) {
        console.error('JSON parse failed:', e?.message);
    }
}

await callCase('nominal', {
    trigger: 'test_nominal',
    telemetry: { battery: 78, wind: 6, alt: 95, stab: 0.96, gps: 0.95, temp: 32, risk: 0.08 },
    issues: [],
    last_command_result: null,
});

await callCase('critical', {
    trigger: 'test_critical',
    telemetry: { battery: 7, wind: 26, alt: 95, stab: 0.58, gps: 0.10, temp: 55, risk: 0.90 },
    issues: [{ key: 'BATTERY_CRITICAL', val: '7%', threshold: '10%', delta: '+3%' }],
    last_command_result: null,
});
