FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine3.24@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS builder

ARG TARGETOS
ARG TARGETARCH
ARG SEAWEEDFS_COMMIT=530be3e37337488ecc34d58441e0bc476e121c93

RUN apk add --no-cache git \
  && mkdir -p /src \
  && git -C /src init \
  && git -C /src remote add origin https://github.com/seaweedfs/seaweedfs.git \
  && git -C /src fetch --depth=1 origin "$SEAWEEDFS_COMMIT" \
  && git -C /src checkout --detach FETCH_HEAD

WORKDIR /src

RUN --mount=type=cache,id=care-go-mod,target=/go/pkg/mod \
  go mod edit -require=golang.org/x/net@v0.60.0 \
  && go mod download golang.org/x/net@v0.60.0

RUN --mount=type=cache,id=care-go-mod,target=/go/pkg/mod \
  mkdir -p /out \
  && GOOS="$TARGETOS" GOARCH="$TARGETARCH" CGO_ENABLED=0 go build \
    -trimpath \
    -buildvcs=false \
    -ldflags="-s -w -X github.com/seaweedfs/seaweedfs/weed/util/version.COMMIT=$(git rev-parse --short HEAD)" \
    -o /out/weed \
    ./weed

FROM chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d

COPY --from=builder --chmod=755 /out/weed /usr/bin/weed

LABEL org.opencontainers.image.source="https://github.com/seaweedfs/seaweedfs" \
  org.opencontainers.image.version="4.48-care-go1.26.9-xnet0.60.0" \
  org.opencontainers.image.revision="530be3e37337488ecc34d58441e0bc476e121c93"
