FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY agent ./agent
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY tsconfig.json ./
RUN mkdir -p data workspace .eve /home/node/.solo-agentic/vault && chown -R node:node /app /home/node/.solo-agentic && chmod 700 /home/node/.solo-agentic/vault
USER node
ENV HOST=0.0.0.0 PORT=4310 MODEL_PROVIDER=gateway
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
