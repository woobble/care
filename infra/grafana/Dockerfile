FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS build

ARG GRAFANA_COMMIT=af4a33e3786594ad72f72d97e6744010330c2977
ARG TARGETOS
ARG TARGETARCH

RUN apk add --no-cache git make

WORKDIR /src

RUN git init \
  && git remote add origin https://github.com/grafana/grafana.git \
  && git fetch --depth=1 origin "$GRAFANA_COMMIT" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "$GRAFANA_COMMIT"

RUN go mod edit -require=github.com/getkin/kin-openapi@v0.149.0 \
  && go mod download github.com/getkin/kin-openapi@v0.149.0 \
  && BUILD_STAMP="$(git show -s --format=%ct HEAD)" \
  && mkdir -p /out \
  && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build \
    -buildvcs=false \
    -trimpath \
    -tags=oss \
    -ldflags="-s -w -X main.version=13.2.4 -X main.commit=$GRAFANA_COMMIT -X main.buildBranch=v13.2.4 -X main.buildstamp=$BUILD_STAMP" \
    -o /out/grafana ./pkg/cmd/grafana

FROM grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f AS upstream

USER root

# The platform provisions only Prometheus. Keep its signed upstream bundle intact
# and drop unused bundled datasource plugins from the final filesystem.
RUN for plugin in /usr/share/grafana/data/plugins-bundled/*; do \
    case "${plugin##*/}" in \
      prometheus) ;; \
      *) rm -rf "$plugin" ;; \
    esac; \
  done

FROM scratch

# Copy the sanitized merged upstream root filesystem so removed plugin binaries
# are absent from the final artifact's layers as well as its visible filesystem.
COPY --from=upstream / /
COPY --from=build --chown=1000:1000 /out/grafana /usr/share/grafana/bin/grafana

ENV PATH="/usr/share/grafana/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  GF_PATHS_CONFIG="/etc/grafana/grafana.ini" \
  GF_PATHS_DATA="/var/lib/grafana" \
  GF_PATHS_HOME="/usr/share/grafana" \
  GF_PATHS_LOGS="/var/log/grafana" \
  GF_PATHS_PLUGINS="/var/lib/grafana/plugins" \
  GF_PATHS_PROVISIONING="/etc/grafana/provisioning"

WORKDIR /usr/share/grafana
USER 472:0
EXPOSE 3000/tcp
ENTRYPOINT ["/run.sh"]

LABEL org.opencontainers.image.source="https://github.com/grafana/grafana" \
  org.opencontainers.image.version="13.2.4-care-kin-openapi-0.149.0-pruned" \
  org.opencontainers.image.revision="af4a33e3786594ad72f72d97e6744010330c2977" \
  org.opencontainers.image.base.name="grafana/grafana:13.2.4" \
  org.opencontainers.image.base.digest="sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f"
