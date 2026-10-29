# SpendSense — Node + Express, Postgres for storage.
#   DATABASE_URL set   -> connects to that Postgres
#   not set            -> embedded PGlite under PGLITE_DIR (mount a volume)
FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=8000
ENV PGLITE_DIR=/data/pgdata
RUN mkdir -p /data

EXPOSE 8000
CMD ["node", "server.js"]
