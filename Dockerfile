# SpendSense — Node + Express. Database is Postgres.
#   with DATABASE_URL set   -> connects to that Postgres (Neon, RDS, anything)
#   without it              -> embedded PGlite, stored in the mounted volume
FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8000
# Only used when DATABASE_URL is absent; mount a volume here so the embedded
# database survives restarts.
ENV PGLITE_DIR=/data/pgdata
RUN mkdir -p /data

EXPOSE 8000
CMD ["node", "server.js"]
