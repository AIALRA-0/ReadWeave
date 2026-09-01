FROM triliumnext/trilium@sha256:8e053aa58a90c1690106a324a4692690ba0491c21ae40485b4051e2911df9489

# Keep the Linux-native server dependencies from the upstream image. Copying
# the local macOS native modules (for example better-sqlite3) would make the
# container fail with an executable-format error.
COPY dist/main.cjs /usr/src/app/main.cjs
COPY dist/docker_healthcheck.cjs /usr/src/app/docker_healthcheck.cjs
COPY dist/meta.json /usr/src/app/meta.json
COPY dist/ckeditor5-content.css /usr/src/app/ckeditor5-content.css

# Replace the ReadWeave browser assets, themes, documentation assets, and PDF
# viewer while leaving the upstream Linux node_modules directory untouched.
COPY dist/assets/ /usr/src/app/assets/
COPY dist/public/ /usr/src/app/public/
COPY dist/share-theme/ /usr/src/app/share-theme/
COPY dist/pdfjs-viewer/ /usr/src/app/pdfjs-viewer/

# Codex and hardened deployment hosts can create release artifacts with a
# restrictive umask (files 0600, directories 0700). The upstream entrypoint
# deliberately runs Trilium as UID 1000, so normalize only read/traverse bits
# after COPY instead of relying on the host's artifact permissions.
RUN chmod -R a+rX \
    /usr/src/app/main.cjs \
    /usr/src/app/docker_healthcheck.cjs \
    /usr/src/app/meta.json \
    /usr/src/app/ckeditor5-content.css \
    /usr/src/app/assets \
    /usr/src/app/public \
    /usr/src/app/share-theme \
    /usr/src/app/pdfjs-viewer
