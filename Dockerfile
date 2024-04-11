ARG VERSION=18

FROM --platform=$BUILDPLATFORM node:$VERSION-alpine as build

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

FROM --platform=$BUILDPLATFORM node:$VERSION-alpine

LABEL maintainer="Renoki Co. <alex@renoki.org>"

COPY --from=build /app /app

WORKDIR /app

EXPOSE 6001

ENTRYPOINT ["node", "/app/bin/server.js", "start"]
