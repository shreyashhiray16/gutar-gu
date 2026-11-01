#!/usr/bin/env bash
# ========================================================
# Gutar GU - Auto Setup with Free Demo Domain (nip.io)
# ========================================================
set -e

echo ">>> [1/6] Detecting Server Public IP..."
# Detect public IP via AWS metadata or curl
PUBLIC_IP=$(curl -s -m 5 http://169.254.169.254/latest/meta-data/public-ipv4 || curl -s -m 5 https://api.ipify.org || echo "")

if [ -n "$PUBLIC_IP" ]; then
    DEMO_DOMAIN="${PUBLIC_IP}.nip.io"
    echo "Detected Public IP: $PUBLIC_IP"
    echo "Configuring Free Demo Domain: $DEMO_DOMAIN"
    
    # Auto-update Caddyfile with nip.io demo domain
    cat <<EOF > Caddyfile
${DEMO_DOMAIN} {
    reverse_proxy web:8000
}
EOF
    echo "Caddyfile updated with ${DEMO_DOMAIN}"
else
    echo "Warning: Could not automatically detect public IP. Keeping existing Caddyfile."
fi

echo ">>> [2/6] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo ">>> [3/6] Installing Docker and Docker Compose plugin..."
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo usermod -aG docker $USER || true

echo ">>> [4/6] Disabling swap for zero-trace in-memory safety..."
sudo swapoff -a || true
sudo sed -i '/swap/d' /etc/fstab || true

echo ">>> [5/6] Starting Gutar GU containers via Docker Compose..."
sudo docker compose down || true
sudo docker compose up -d --build

echo ">>> [6/6] SUCCESS! Gutar GU is now running."
if [ -n "$PUBLIC_IP" ]; then
    echo "=========================================================="
    echo "Your Live Chat Demo URL with Free SSL:"
    echo "https://${DEMO_DOMAIN}"
    echo "=========================================================="
fi
