FROM node:16-alpine3.18

RUN apk update && apk upgrade && \
    apk add --no-cache bash coreutils grep sed \
      chromium=115.0.5790.170-r0 \
      tzdata \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont \
      ca-certificates \
      yarn \
      redis \
      vim 

#ENV DEBUG=1
ENV TZ=Europe/Berlin
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV NODE_PATH="/usr/local/share/.config/yarn/global/node_modules:${NODE_PATH}"

RUN yarn global add puppeteer@21.0.2 telegraf better-sqlite3
RUN yarn install

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROMIUM_PATH=/usr/bin/chromium-browser


WORKDIR /usr/src/app

ENTRYPOINT [ "node", "index.js" ]