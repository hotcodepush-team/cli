#!/bin/sh
# Compiles bsdiff.wasm in one Rust image, pinned by digest, so every build of these sources yields the same bytes.
# The image is linux/amd64 on every host: cargo hashes the host into symbol names, which reorders the module's functions.
set -eu
cd "$(dirname "$0")"
docker run --rm --platform linux/amd64 --volume "$PWD":/bsdiff-wasm --workdir /bsdiff-wasm \
  rust:1.99.0-slim-trixie@sha256:87f8773645d18bb8f4b4921212a198adbcbcea24ed7fd13c5ae473b7538f5093 \
  sh -c 'rustup target add wasm32-unknown-unknown &&
    cargo build --locked --release --target wasm32-unknown-unknown --target-dir /tmp/target &&
    install -m 644 /tmp/target/wasm32-unknown-unknown/release/bsdiff_wasm.wasm bsdiff.wasm'
