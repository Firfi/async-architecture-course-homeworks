FROM debian:bookworm

RUN apt-get update && apt-get install -y curl jq
