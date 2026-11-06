FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
# Proxy CA is a build-only mount. Signed Debian metadata and an explicit Git
# version are required; deployments approve the resulting immutable image ID.
RUN --mount=type=secret,id=proxy_ca,required=false \
    apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca update \
    && apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca install -y --no-install-recommends git=1:2.39.5-0+deb12u3 \
    && rm -rf /var/lib/apt/lists/*
COPY worker.mjs /runtime/worker.mjs
RUN chmod 0755 /runtime && chmod 0444 /runtime/worker.mjs
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["node", "/runtime/worker.mjs"]
