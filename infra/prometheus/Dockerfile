FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS build

ARG PROMETHEUS_COMMIT=5241a27fe3c6983549fccc32f6e65917408c63cd
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

RUN apk add --no-cache bash ca-certificates coreutils curl git gzip \
  && git init \
  && git remote add origin https://github.com/prometheus/prometheus.git \
  && git fetch --depth=1 origin "$PROMETHEUS_COMMIT" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "$PROMETHEUS_COMMIT"

RUN curl -fsSLo /tmp/prometheus-web-ui.tar.gz \
    https://github.com/prometheus/prometheus/releases/download/v3.15.0/prometheus-web-ui-3.15.0.tar.gz \
  && printf '%s  %s\n' \
    'fa8c918ed05e3f89e232e9b69eccd6ed074602cd9e8a2cab7a92bec9651974ae' \
    '/tmp/prometheus-web-ui.tar.gz' | sha256sum -c - \
  && tar -xzf /tmp/prometheus-web-ui.tar.gz -C web/ui \
  && test -d web/ui/static

RUN --mount=type=cache,id=care-go-mod,target=/go/pkg/mod \
  PREBUILT_ASSETS_STATIC_DIR=web/ui/static scripts/compress_assets.sh \
  && go mod edit -require=golang.org/x/net@v0.60.0 \
  && go mod download golang.org/x/net@v0.60.0 \
  && mkdir -p /out \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build \
    -trimpath \
    -buildvcs=false \
    -tags=netgo,builtinassets \
    -ldflags='-s -w -X github.com/prometheus/common/version.Version=3.15.0 -X github.com/prometheus/common/version.Revision=5241a27fe3c6983549fccc32f6e65917408c63cd -X github.com/prometheus/common/version.Branch=release-3.15 -X github.com/prometheus/common/version.BuildUser=care-security-build -X github.com/prometheus/common/version.BuildDate=20260909-00:00:00' \
    -o /out/prometheus ./cmd/prometheus \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build \
    -trimpath \
    -buildvcs=false \
    -tags=netgo,builtinassets \
    -ldflags='-s -w -X github.com/prometheus/common/version.Version=3.15.0 -X github.com/prometheus/common/version.Revision=5241a27fe3c6983549fccc32f6e65917408c63cd -X github.com/prometheus/common/version.Branch=release-3.15 -X github.com/prometheus/common/version.BuildUser=care-security-build -X github.com/prometheus/common/version.BuildDate=20260909-00:00:00' \
    -o /out/promtool ./cmd/promtool

FROM prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e

COPY --from=build --chmod=755 /out/prometheus /bin/prometheus
COPY --from=build --chmod=755 /out/promtool /bin/promtool

LABEL org.opencontainers.image.source="https://github.com/prometheus/prometheus" \
  org.opencontainers.image.version="3.15.0-care-go1.26.9-xnet0.60.0" \
  org.opencontainers.image.revision="5241a27fe3c6983549fccc32f6e65917408c63cd"
