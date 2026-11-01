# 🆓 Gutar GU — AWS Deployment with Free Demo Domains (No Domain Needed)

Since you don't own a custom domain, this guide shows you how to host Gutar GU **with 100% free SSL (HTTPS + WSS)** using a free demo domain.

---

## 💡 The Problem & The Solution

- **The Problem**: Web Crypto E2EE (`window.crypto.subtle`) strictly requires **HTTPS / TLS**. Plain IP addresses (like `http://3.85.120.45`) cannot easily obtain free Let's Encrypt SSL certificates.
- **The Solution**: Use a **Free Dynamic Demo DNS Hostname**.
  You have 2 free options:
  1. **Option 1 (Zero-Signup nip.io)**: `3-85-120-45.nip.io` maps automatically to your AWS IP with **zero signup required**.
  2. **Option 2 (AWS App Runner Default Domain)**: AWS automatically provides a free HTTPS domain like `https://xxxxxx.us-east-1.awsapprunner.com`.

---

## 🚀 Recommended Method: EC2 Free Tier + `nip.io` Free Demo Domain

`nip.io` is a free wildcard DNS service. Any IP written as `<IP>.nip.io` resolves directly to that IP. Let's Encrypt issues real, valid SSL certificates for it.

### Step 1: Launch Your EC2 Instance (100% Free Tier)
1. Go to **AWS Console** → search for **EC2** → click **Launch Instance**.
2. **Name**: `gutar-gu-server`.
3. **OS**: Select **Ubuntu** (Ubuntu 24.04 or 22.04 LTS — *Free tier eligible*).
4. **Instance type**: `t2.micro` or `t3.micro` (*Free tier eligible*).
5. **Key pair**: Create new key pair `gutar-gu-key.pem` (or proceed without a key pair if using EC2 Instance Connect).
6. **Network settings**: Check:
   - ☑️ **Allow SSH**
   - ☑️ **Allow HTTPS** (Port 443)
   - ☑️ **Allow HTTP** (Port 80)
7. Click **Launch Instance**.

---

### Step 2: Assign an Elastic IP (Static IP)
*(Elastic IPs are 100% free while attached to your running EC2 instance).*

1. In the EC2 sidebar under **Network & Security**, click **Elastic IPs**.
2. Click **Allocate Elastic IP address** → **Allocate**.
3. Select your IP → click **Actions** → **Associate Elastic IP address**.
4. Select your `gutar-gu-server` instance → click **Associate**.
5. **Copy your Public IPv4 address** (for example: `3.85.120.45`).

Your free demo domain is now:
```
3.85.120.45.nip.io
```
*(Replace `3.85.120.45` with your actual Elastic IP!)*

---

### Step 3: Connect via Browser Terminal

1. In EC2 Console → **Instances** → select your instance.
2. Click the **Connect** button at the top.
3. Select **EC2 Instance Connect** → click **Connect**.
4. A terminal opens in your browser.

---

### Step 4: Clone the Repo & Run

In the EC2 browser terminal, run:

```bash
# 1. Update and install Git
sudo apt update && sudo apt install -y git

# 2. Clone your GitHub repository
git clone https://github.com/shreyashhiray16/gutar-gu.git
cd gutar-gu/Gutar\ GU/chat-app
```

---

### Step 5: Configure the Demo Domain in `Caddyfile`

Edit `Caddyfile` using `nano`:
```bash
nano Caddyfile
```

Set your nip.io demo domain (using your Elastic IP):
```caddy
3.85.120.45.nip.io {
    reverse_proxy web:8000
}
```
*(Replace `3.85.120.45` with your actual Elastic IP!)*

Press `Ctrl + O`, then `Enter` to save, and `Ctrl + X` to exit.

---

### Step 6: Start the Server

Run the automated setup script:
```bash
chmod +x setup_lightsail_ec2.sh
./setup_lightsail_ec2.sh
```

---

## 🎉 Test Your Live Demo Chat!

Open your browser and visit:
```
https://3.85.120.45.nip.io
```
*(Using your actual Elastic IP)*

- **Padlock (HTTPS)**: Valid Let's Encrypt TLS certificate issued automatically.
- **WebSockets (`wss://`)**: Active and encrypted.
- **E2EE Badge**: Displays `🔒 E2EE Active`.
- **Zero Trace**: Messages wipe cleanly across both sides upon exit.
