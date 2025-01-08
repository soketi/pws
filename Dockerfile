ARG VERSION=lts

FROM --platform=$BUILDPLATFORM node:$VERSION-alpine AS build


ENV PYTHONUNBUFFERED=1

COPY . /tmp/build

WORKDIR /tmp/build

RUN apk add --no-cache --update git python3 gcompat ; \
    apk add --virtual build-dependencies build-base gcc wget ; \
    ln -sf python3 /usr/bin/python ; \
    python3 -m ensurepip ; \
    pip3 install --no-cache --upgrade pip setuptools ; \
    npm ci ; \
    npm run build ; \
    npm ci --omit=dev --ignore-scripts ; \
    npm prune --production ; \
    rm -rf node_modules/*/test/ node_modules/*/tests/ ; \
    npm install -g modclean ; \
    modclean -n default:safe --run ; \
    mkdir -p /app ; \
    cp -r bin/ dist/ node_modules/ LICENSE package.json package-lock.json README.md /app/

FROM node:$VERSION-alpine
ARG TARGETPLATFORM

LABEL org.opencontainers.image.authors="Soketi <open-source@soketi.app>"
LABEL org.opencontainers.image.source="https://github.com/soketi/soketi"
LABEL org.opencontainers.image.url="https://soketi.app"
LABEL org.opencontainers.image.documentation="https://docs.soketi.app"
LABEL org.opencontainers.image.vendor="Soketi"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

RUN apk add --no-cache libc6-compat ; \
    if [ -e /lib/ld-linux-x86-64.so.2 ]; then rm -f /lib/ld-linux-x86-64.so.2; fi; \
    ln -s /lib/libc.musl-x86_64.so.1 /lib/ld-linux-x86-64.so.2


COPY --from=build /app /app

WORKDIR /app

EXPOSE 6001

ENTRYPOINT ["node", "/app/bin/server.js", "start"]
