FROM node:24-trixie-slim AS node
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
FROM gosom/google-maps-scraper@sha256:e205c02913c5a69c16fc2094b8e5b194a2f655166d2c1126d50548d216e6b1b2
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /worker/node_modules /worker/node_modules
COPY worker.mjs /worker/worker.mjs
ENV DISABLE_TELEMETRY=1
WORKDIR /worker
ENTRYPOINT ["node", "/worker/worker.mjs"]
