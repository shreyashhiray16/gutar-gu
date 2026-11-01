# 🚀 Gutar GU — AWS Deployment Guide

Step-by-step instructions to deploy Gutar GU to AWS. Choose either **Method 1 (AWS App Runner — Fully Managed)** or **Method 2 (AWS Lightsail — $3.50/mo flat)**.

---

## 🌟 Method 1: AWS App Runner (Serverless & Fully Managed — Recommended)

No servers or operating systems to manage. AWS automatically provisions HTTPS and manages scaling and WebSockets.

### Prerequisites:
- AWS Account
- Docker installed locally
- AWS CLI installed (`aws configure` with your credentials)

### Steps:

#### 1. Push Container Image to Amazon ECR
Inside `Gutar GU/chat-app`, run the automated push script:
```cmd
deploy_aws_ecr.bat <YOUR_AWS_ACCOUNT_ID> <YOUR_AWS_REGION>
```
*(Example: `deploy_aws_ecr.bat 123456789012 us-east-1`)*

#### 2. Create the App Runner Service
1. Open the **AWS Console** and search for **App Runner**.
2. Click **Create service**.
3. Under **Repository type**, choose **Container registry** → **Amazon ECR**.
4. Click **Browse** and select `gutar-gu:latest`.
5. Under **Deployment trigger**, select **Manual** or **Automatic**.
6. Under **ECR access role**, select **Create new service role** (or choose your existing App Runner role) and click **Next**.
7. **Configure service**:
   - **Service name**: `gutar-gu-chat`
   - **Virtual CPU**: `1 vCPU`
   - **Memory**: `2 GB`
   - **Port**: `8000`
   - **Environment variables**:
     - Key: `PORT`, Value: `8000`
     - Key: `ROOM_TOKEN`, Value: *(a random string like `k9d8s7df6a5sd4f`)*
8. Click **Next** → **Create & Deploy**.

In ~3 minutes, App Runner will give you a default live URL like:
`https://xxxxxx.us-east-1.awsapprunner.com`

#### 3. Custom Domain & HTTPS
1. In your App Runner dashboard, go to the **Custom domains** tab.
2. Click **Link domain** and type your domain (e.g. `chat.yourdomain.com`).
3. Add the displayed CNAME validation records into your DNS registrar (GoDaddy, Namecheap, Cloudflare, Route 53).
4. App Runner issues and auto-renews free SSL/TLS certificates.

---

## 💰 Method 2: AWS Lightsail (Cost-Effective $3.50/mo Flat)

If you prefer full control and a flat monthly bill.

### Steps:

#### 1. Create a Lightsail Instance
1. Go to **AWS Console** → **Amazon Lightsail** (or [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)).
2. Click **Create instance**.
3. Choose **Linux/Unix** → **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS**.
4. Choose the **$3.50/month** plan (1 vCPU, 512MB/1GB RAM).
5. Name the instance `gutar-gu-chat` and click **Create instance**.

#### 2. Attach a Static IP and Open Ports
1. Go to the **Networking** tab in Lightsail → Click **Create Static IP** → Attach it to your `gutar-gu-chat` instance.
2. In your instance's **Networking** firewall settings, add firewall rules:
   - **HTTP**: Port `80` (TCP)
   - **HTTPS**: Port `443` (TCP)
   - **SSH**: Port `22` (TCP)

#### 3. Point Your Domain Name
In your DNS provider (Cloudflare, GoDaddy, Namecheap, Route 53):
- Create an **A record**:
  - Name: `chat` (or `@` for root)
  - Value: `<Your Lightsail Static IP>`

#### 4. Deploy Application
1. Click **Connect using SSH** in the Lightsail console.
2. Clone or copy your `chat-app` directory into the server:
   ```bash
   git clone <your-repo-url>
   cd chat-app
   ```
3. Update the `Caddyfile` with your domain:
   ```caddy
   chat.yourdomain.com {
       reverse_proxy web:8000
   }
   ```
4. Run the automated setup script:
   ```bash
   chmod +x setup_lightsail_ec2.sh
   ./setup_lightsail_ec2.sh
   ```
5. Caddy will automatically fetch a free Let's Encrypt TLS certificate. Your app is live at `https://chat.yourdomain.com` with full WSS and zero-trace wipe!

