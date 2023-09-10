FROM node:16-alpine3.16

RUN apk update && apk upgrade && \
    apk add --no-cache bash coreutils grep sed \
      chromium \
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

RUN yarn global add puppeteer@14.0 telegraf redis
RUN yarn install

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/src/app

COPY ["start.sh", "./"]
RUN chmod +x ./start.sh

ENTRYPOINT [ "./start.sh" ]