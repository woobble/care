FROM amazon/aws-cli:2.37.4@sha256:fdd8d1fcbea9c371678dee5a40df8b178c7a781b4586605756ee28114c97ead6

USER root
RUN dnf upgrade --releasever=2023.12.20261013 -y \
  && dnf clean all \
  && rm -rf /var/cache/dnf
