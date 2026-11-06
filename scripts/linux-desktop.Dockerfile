# The test image plus what the Electrobun desktop app needs at run time on Linux, and a virtual display with a window
# manager to start it on and close its window the way a user would, and Rust for the release's peer-to-peer sidecar.
ARG ARCH
FROM mirador-linux-test-${ARCH}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2 \
      xvfb xauth x11-utils imagemagick zstd openbox wmctrl xdotool \
 && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config && rm -rf /var/lib/apt/lists/*
USER ubuntu
# A release builds the peer-to-peer sidecar from source, with the Rust mirador-p2p's Cargo.toml asks for or later.
ARG RUST_VERSION=1.99.1
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --quiet --profile minimal --default-toolchain "$RUST_VERSION"
ENV PATH=/home/ubuntu/.cargo/bin:$PATH
