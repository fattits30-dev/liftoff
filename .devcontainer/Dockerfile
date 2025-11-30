FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install additional dependencies for VS Code extension development
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    xvfb \
    libgtk-3-0 \
    libgbm1 \
    libnss3 \
    libasound2 \
    libxss1 \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install global npm packages for testing
RUN npm install -g \
    @vscode/test-cli \
    @vscode/test-electron \
    mocha \
    typescript

# Set up Python for testing backend code generation
RUN pip3 install --no-cache-dir \
    pytest \
    pytest-cov \
    black \
    ruff \
    mypy

USER node
