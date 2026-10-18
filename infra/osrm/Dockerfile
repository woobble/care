FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f AS osrm

FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS launcher-build

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src
COPY launcher.go .
RUN CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build \
  -trimpath \
  -buildvcs=false \
  -ldflags='-s -w' \
  -o /out/care-osrm-launcher ./launcher.go

FROM gcr.io/distroless/cc-debian13:latest@sha256:480c5ff295373a2223ae2a08b7793e98c8f22c90f6ae9b20fe1f61feffda72ea

COPY --from=osrm --chown=0:0 /usr/local/bin/osrm-routed /usr/local/bin/osrm-routed
COPY --from=launcher-build --chown=0:0 /out/care-osrm-launcher /usr/local/bin/care-osrm-launcher

# The mounted dataset generation directories are mode 0700, matching the
# existing official OSRM runtime's root user. Keep that storage contract.
ENTRYPOINT ["/usr/local/bin/care-osrm-launcher"]

LABEL org.opencontainers.image.source="https://github.com/Project-OSRM/osrm-backend" \
  org.opencontainers.image.version="v26.10.0-distroless-debian13-go1.26.9" \
  org.opencontainers.image.base.name="ghcr.io/project-osrm/osrm-backend:v26.10.0-debian" \
  org.opencontainers.image.base.digest="sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f"
