@echo off
REM ========================================================
REM Gutar GU - AWS ECR Build & Push Script
REM Usage: deploy_aws_ecr.bat <AWS_ACCOUNT_ID> <AWS_REGION>
REM Example: deploy_aws_ecr.bat 123456789012 us-east-1
REM ========================================================

IF "%~1"=="" (
    echo Error: AWS Account ID missing.
    echo Usage: deploy_aws_ecr.bat ^<AWS_ACCOUNT_ID^> ^<AWS_REGION^>
    exit /b 1
)

IF "%~2"=="" (
    echo Error: AWS Region missing.
    echo Usage: deploy_aws_ecr.bat ^<AWS_ACCOUNT_ID^> ^<AWS_REGION^>
    exit /b 1
)

SET AWS_ACCOUNT_ID=%~1
SET AWS_REGION=%~2
SET REPO_NAME=gutar-gu
SET ECR_URI=%AWS_ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com/%REPO_NAME%

echo [1/4] Ensuring ECR repository exists...
aws ecr describe-repositories --repository-names %REPO_NAME% --region %AWS_REGION% >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Creating ECR repository: %REPO_NAME%...
    aws ecr create-repository --repository-name %REPO_NAME% --region %AWS_REGION%
)

echo [2/4] Logging in to Amazon ECR...
aws ecr get-login-password --region %AWS_REGION% | docker login --username AWS --password-stdin %AWS_ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com
IF %ERRORLEVEL% NEQ 0 (
    echo Docker login to ECR failed. Make sure AWS CLI is configured with valid credentials.
    exit /b 1
)

echo [3/4] Building Docker container...
docker build -t %REPO_NAME%:latest .

echo [4/4] Tagging and pushing to Amazon ECR...
docker tag %REPO_NAME%:latest %ECR_URI%:latest
docker push %ECR_URI%:latest

echo.
echo ========================================================
echo Deployment image successfully pushed to:
echo %ECR_URI%:latest
echo.
echo Now open AWS App Runner:
echo 1. Create Service -> Container Registry -> Amazon ECR
echo 2. Select image: %ECR_URI%:latest
echo 3. Port: 8000
echo ========================================================

