FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG ORIGIN=http://localhost:3000
ENV ORIGIN=$ORIGIN
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=55M MEDIA_DIR=/app/data/media
ARG REVISION=unknown
ENV APP_REVISION=$REVISION
LABEL org.opencontainers.image.source="https://github.com/AlexanderHeffernan/LastPeek" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json /app/LICENSE /app/README.md ./
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/migrations ./migrations
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/docs ./docs
COPY --from=builder --chown=node:node /app/static ./static
COPY --from=builder --chown=node:node /app/vite.config.ts /app/tsconfig.json /app/Dockerfile /app/compose.yaml ./
RUN mkdir -p /app/data/media && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
