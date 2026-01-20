#!/bin/bash
# start_local.sh - Setup and run Sattrack locally (Native Mode)

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Sattrack Local Setup ===${NC}"

# 1. Install System Dependencies (requires sudo)
echo -e "\n${YELLOW}[1/4] Checking system dependencies (rtl-sdr, sox)...${NC}"
if ! command -v rtl_sdr &> /dev/null || ! command -v sox &> /dev/null; then
    echo "Installing missing system packages. You may be asked for your password."
    sudo apt-get update
    sudo apt-get install -y rtl-sdr sox libsox-fmt-mp3 python3-venv python3-full
else
    echo -e "${GREEN}System dependencies already installed.${NC}"
fi

# 2. Create Virtual Environment
echo -e "\n${YELLOW}[2/4] Setting up Python virtual environment...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Virtual environment created."
else
    echo -e "${GREEN}Virtual environment already exists.${NC}"
fi

# 3. Install Python Requirements
echo -e "\n${YELLOW}[3/4] Installing Python dependencies...${NC}"
# Use the pip inside the venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# 4. Start Application
echo -e "\n${GREEN}=== Setup Complete! Starting Sattrack... ===${NC}"
echo "Access the interface at: http://$(hostname -I | awk '{print $1}'):5000"
echo "Press Ctrl+C to stop."
echo ""

# Run app using the venv python
./venv/bin/python app.py
