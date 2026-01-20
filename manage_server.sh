#!/bin/bash
# manage_server.sh - Manage Sattrack Server Locally

# Configuration
VENV_DIR="venv"
PID_FILE="sattrack.pid"
LOG_FILE="sattrack.log"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

function install_deps() {
    echo -e "${GREEN}=== Installing Dependencies ===${NC}"
    
    # Check for System Dependencies (IMPORTANT: These CANNOT be installed in a venv)
    # They are binary system tools, not Python packages.
    echo -e "\n${YELLOW}[1/3] Installing System Tools (requires sudo)...${NC}"
    echo "Installing: rtl-sdr, sox, multimon-ng"
    
    if ! command -v rtl_sdr &> /dev/null || ! command -v sox &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y rtl-sdr sox libsox-fmt-mp3 multimon-ng python3-venv python3-full
    else
        echo -e "${GREEN}System tools already installed via apt.${NC}"
    fi

    # Venv Setup
    echo -e "\n${YELLOW}[2/3] Setting up Python Virtual Environment...${NC}"
    if [ ! -d "$VENV_DIR" ]; then
        python3 -m venv $VENV_DIR
        echo "Virtual environment created."
    else
        echo "Virtual environment exists."
    fi

    # Python Deps
    echo -e "\n${YELLOW}[3/3] Installing Python Packages (inside venv)...${NC}"
    ./$VENV_DIR/bin/pip install --upgrade pip
    ./$VENV_DIR/bin/pip install -r requirements.txt
    
    echo -e "${GREEN}Installation Complete!${NC}"
}

function start_server() {
    if [ -f "$PID_FILE" ]; then
        if ps -p $(cat $PID_FILE) > /dev/null; then
            echo -e "${RED}Server is already running (PID: $(cat $PID_FILE))${NC}"
            return
        else
            rm "$PID_FILE" # Stale PID file
        fi
    fi

    echo -e "${GREEN}Starting Sattrack Server in background...${NC}"
    # Run using venv python, redirect logs, save PID
    nohup ./$VENV_DIR/bin/python app.py > "$LOG_FILE" 2>&1 &
    
    echo $! > "$PID_FILE"
    echo -e "Server started with PID $(cat $PID_FILE)"
    echo -e "Logs are being written to ${YELLOW}$LOG_FILE${NC}"
    echo -e "Access at: http://$(hostname -I | awk '{print $1}'):5000"
}

function stop_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat $PID_FILE)
        if ps -p $PID > /dev/null; then
            echo -e "${YELLOW}Stopping server (PID: $PID)...${NC}"
            kill $PID
            rm "$PID_FILE"
            echo -e "${GREEN}Server stopped.${NC}"
        else
            echo -e "${RED}Process $PID not found. Removing stale PID file.${NC}"
            rm "$PID_FILE"
        fi
    else
        echo -e "${RED}No running server found (no PID file).${NC}"
    fi
}

function show_logs() {
    echo -e "${YELLOW}Showing logs (Ctrl+C to exit)...${NC}"
    tail -f "$LOG_FILE"
}

# Command Router
case "$1" in
    install)
        install_deps
        ;;
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        start_server
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "Usage: $0 {install|start|stop|restart|logs}"
        exit 1
        ;;
esac
