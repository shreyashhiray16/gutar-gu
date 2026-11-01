#!/usr/bin/env bash
# ========================================================
# Gutar GU - AWS Lightsail / EC2 Auto-Setup Script
# Run this directly on an Ubuntu 22.04 / 24.04 instance
# ========================================================
set -e

echo ">>> [1/5] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo ">>> [2/5] Installing Docker and Docker Compose plugin..."
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow current user to run docker
sudo usermod -aG docker $USER || true

echo ">>> [3/5] Disabling swap (protecting in-memory ephemeral zero-trace promises)..."
sudo swapoff -a || true
sudo sed -i '/swap/d' /etc/fstab || true

echo ">>> [4/5] Checking docker compose configuration..."
if [ -f "docker-compose.yml" ]; then
    echo "Starting Gutar GU containers via Docker Compose..."
    sudo docker compose up -d --build
    echo "Containers started successfully!"
else
    echo "Warning: docker-compose.yml not found in current directory. Please navigate to the project directory and run 'sudo docker compose up -d --build'."
fi

echo ">>> [5/5] Setup Complete! If you configured your domain in Caddyfile, Gutar GU is now accessible over HTTPS & WSS."

