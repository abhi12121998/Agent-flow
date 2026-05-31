#!/usr/bin/env bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Yuno AI Agent Platform            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──────────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required"; exit 1; }
command -v node    >/dev/null 2>&1 || { echo "ERROR: node is required (v18+)"; exit 1; }
command -v npm     >/dev/null 2>&1 || { echo "ERROR: npm is required"; exit 1; }

# ── Environment ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -z "$GROQ_API_KEY" ]; then
    echo "Enter your Groq API key (free at console.groq.com):"
    read -r GROQ_API_KEY
  fi
  JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  echo "GROQ_API_KEY=$GROQ_API_KEY" > .env
  echo "JWT_SECRET=$JWT_SECRET" >> .env
  echo "✓ .env created"
else
  echo "✓ .env found"
  export $(grep -v '^#' .env | xargs)
fi

# ── Backend ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ Installing backend dependencies..."
cd backend
python3 -m venv .venv 2>/dev/null || true
source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate 2>/dev/null || true
pip install -r requirements.txt -q
echo "✓ Backend dependencies installed"

# Run tests
echo ""
echo "▶ Running tests..."
python -m pytest tests/ -q --tb=short 2>&1 | tail -5
echo ""

# Start backend in background
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "✓ Backend started (PID $BACKEND_PID) → http://localhost:8000"
cd ..

# ── Frontend ─────────────────────────────────────────────────────────────────
echo ""
echo "▶ Installing frontend dependencies..."
cd frontend-react
npm install -q
echo "✓ Frontend dependencies installed"

# Start frontend in background
VITE_API_URL=http://localhost:8000 npm run dev &
FRONTEND_PID=$!
echo "✓ Frontend started (PID $FRONTEND_PID) → http://localhost:5173"
cd ..

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo "  🚀 Yuno Platform is running!"
echo ""
echo "  UI:      http://localhost:5173"
echo "  API:     http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "  To stop: kill $BACKEND_PID $FRONTEND_PID"
echo "════════════════════════════════════════════"
echo ""

# Wait for both
wait
