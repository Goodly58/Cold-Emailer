FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/data/db.json ./seed-db.json

# Live data lives at /data/db.json — mount a persistent volume at /data so
# your tracker survives redeploys. Seeded from the repo's db.json on first boot.
ENV DB_PATH=/data/db.json
EXPOSE 3000
CMD ["sh", "-c", "mkdir -p /data && ([ -f /data/db.json ] || cp ./seed-db.json /data/db.json) && node server.js"]
