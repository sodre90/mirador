# The test image plus what the Electrobun desktop app needs at run time on Linux, and a virtual display with a window
# manager to start it on and close its window the way a user would.
ARG ARCH
FROM mirador-linux-test-${ARCH}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2 \
      xvfb xauth x11-utils imagemagick zstd openbox wmctrl xdotool \
 && rm -rf /var/lib/apt/lists/*
USER ubuntu
