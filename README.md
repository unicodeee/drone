# AFSM: Autonomous Flight Safety Monitor

AFSM is a real-time drone flight safety monitoring dashboard powered by the **NVIDIA Nemotron-3 9B** model. It bridges manual flight simulation with intelligent, AI-driven safety interventions to ensure mission success in unpredictable environments.

![AFSM Dashboard](https://raw.githubusercontent.com/unicodeee/drone-sim-agent-hackathon-NVIDIA/kk-dev/public/preview.png) *(Note: Add a real preview image to public/ folder if available)*

## 🚀 Overview

The system monitors critical drone telemetry—including battery levels, wind speeds, wing stability, GPS signal integrity, and motor temperature. When safety thresholds are breached or disturbances are injected, the AFSM Agent (driven by NVIDIA Nemotron) analyzes the state and recommends high-precision navigational commands.

## 🧠 AI Integration: NVIDIA Nemotron

This project utilizes the `nvidia/nemotron-nano-9b-v2:free` model via **OpenRouter** to perform complex safety reasoning.

### Key AI Features:
- **Strict JSON Output**: Enforced schema for seamless frontend integration.
- **Contextual Reasoning**: Real-time analysis of telemetry trends and active issues.
- **Robustness Layer**: Backend middleware provides automated retries and strict semantic normalization of LLM outputs.
- **Low Latency**: Optimized parameters (Temperature: 0.2, Max Tokens: 450) for fast safety updates.

## 🛠 Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, React, Canvas API (for flight paths and HUD).
- **Backend**: Next.js API Routes (Edge-ready logic).
- **Styling**: Vanilla CSS (Cyberpunk/Aeronautics high-visibility theme).
- **Model**: NVIDIA Nemotron-3 9B (via OpenRouter).

## 🚦 Features

- **Real-time HUD**: Visualizing battery, wind, altitude, stability, GPS, and thermal data.
- **Disturbance Injection**: Simulate Wind Spikes, Bird Strikes, Battery Drops, and GPS Jamming to test AI responses.
- **Agent Decision Loop**: The AI doesn't just warn; it issues executable `CMD:` commands (e.g., `CMD: EMERGENCY_LAND`).
- **Interactive Decision Log**: A categorized log of every telemetry tick and agent decision.
- **Safety Interventions**: Operator-approval workflow for AI-recommended actions.

## ⚙️ Setup & Installation

### 1. Clone the repository
```bash
git clone https://github.com/unicodeee/drone-sim-agent-hackathon-NVIDIA.git
cd drone-sim-agent-hackathon-NVIDIA
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory:
```bash
OPENROUTER_API_KEY=your_sk_or_v1_api_key_here
OPENROUTER_MODEL=nvidia/nemotron-nano-9b-v2:free
```

### 4. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## 🏗 Project Structure

```text
├── app/
│   ├── api/decision/route.ts  # Nemotron logic & Normalization
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # AFSM Dashboard & Simulator logic
├── public/                    # Static assets
├── .env.local.example         # Template for API keys
├── package.json               # Dependencies
└── tsconfig.json              # TypeScript configuration
```

## 🛡 Safety Protocols

The AFSM Agent follows a strict hierarchy of safety rules:
1. **Critical Battery (< 10%) + Critical GPS**: Immediate `EMERGENCY_LAND`.
2. **Critical Wind (> 24 m/s) + High Alt**: Forced `EMERGENCY_DESCENT`.
3. **Stability Loss**: Intelligent `STABILIZE` or `DIVERT` commands.

---
*Built for the Drone Simulation Agent Hackathon - NVIDIA*
