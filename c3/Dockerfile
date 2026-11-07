FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc make git ca-certificates libssl-dev zlib1g-dev libmicrohttpd-dev socat curl \
    && rm -rf /var/lib/apt/lists/*

# c3 builds against sibling checkouts of the cor-libs; commits are pinned so the image is reproducible.
WORKDIR /src
RUN set -e; \
    clone() { git clone -q https://github.com/SEAMWARE/$1 && git -C $1 checkout -q $2; }; \
    clone corBase  3d9fcc01a746c6e6e234b9effb0dccee9185cd25; \
    clone corLog   dc194af424d30b86c72719bbb56dcaa809b8c4fb; \
    clone corAlloc 71fb4de847b8917ace1feb50b945b1e0e2dc9e2d; \
    clone corArgs  44bbe9f6ac1f0a915d83a57ae2b9e72585d19be4; \
    clone corTree  812dadc9a6238a1709e46ff5a771be3d14fcdfbd; \
    clone corJson  61808181f73c917723f94103ed19e08a83b8f850; \
    clone corHttp  f29861eb8a478d18fde118e337982084fd48bc30; \
    clone corRest  fa4bf70664b9a041f224d2a707d5514753a21431; \
    clone c3       1bb1d9d0936bde0ddd7b062bd87437659a7db389; \
    for r in corBase corLog corAlloc corArgs corTree corJson corHttp; do make -C $r; done; \
    make -C corRest CC="gcc -D_GNU_SOURCE="; \
    make -C c3 EXTRA_CFLAGS="-D_GNU_SOURCE="

# Apetit look and feel: an override stylesheet linked after c3.css, plus its fonts and logo.
COPY apetit /src/c3/www/apetit
RUN sed -i 's#<link rel="stylesheet" href="css/c3.css">#&\n<link rel="stylesheet" href="apetit/apetit.css">#; s#<title>[^<]*</title>#<title>Apetit Climate \&amp; Nature Navigator - relationships</title>#; s#img/coraine-mark.png#apetit/favicon-32.png#; s#class="mark" src="apetit/favicon-32.png"#class="mark" src="apetit/logo-apetit.png"#' /src/c3/www/index.html

COPY entrypoint.sh /entrypoint.sh
EXPOSE 7900
ENTRYPOINT ["/entrypoint.sh"]
