FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
COPY codex /runtime/codex
COPY worker.mjs /runtime/worker.mjs
RUN chmod 0555 /runtime/codex && chmod 0444 /runtime/worker.mjs
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["node", "/runtime/worker.mjs"]
