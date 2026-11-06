# KneeDeep: one image, one origin. The API serves the built web app.
#   docker build -t kneedeep .
#   docker run --env-file .env -p 8080:3000 kneedeep

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci
COPY api api
COPY web web
RUN npm run build -w web && npm run build -w api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci --omit=dev --workspace=api && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/db api/db
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "api/dist/main.js"]
