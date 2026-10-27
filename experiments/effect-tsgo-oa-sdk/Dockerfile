# Separate review-only toolchain. Do not install OA SDK source-workspace deps here.
# node:26-bookworm is a moving major/OS tag; record the resolved image digest
# alongside each reviewed run and optionally pin @sha256 after validation.
FROM node:26-bookworm

WORKDIR /workspace
# Compose binds the experiment directory and mounts empty named volumes on
# node_modules/npm cache. Create writable seed directories for the non-root node user.
RUN mkdir -p /workspace/node_modules /home/node/.npm \
    && chown -R node:node /workspace /home/node/.npm

USER node
ENV NPM_CONFIG_CACHE=/home/node/.npm
