FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS gosu-build

ARG TARGETOS
ARG TARGETARCH

RUN apk add --no-cache git \
  && git clone --depth 1 --branch 1.19 https://github.com/tianon/gosu.git /src \
  && test "$(git -C /src rev-parse HEAD)" = 6456aaa0f3c854d199d0f037f068eb97515b7513

WORKDIR /src
RUN CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath -o /gosu .

FROM postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

COPY --from=gosu-build --chmod=755 /gosu /usr/local/bin/gosu
