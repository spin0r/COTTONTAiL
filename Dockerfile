FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p nzb_downloads temp_zip_uploads static

ENV TELEGRAM_TOKEN=""
ENV TELEGRAPH_TOKEN=""
ENV AUTHORIZED_USERS=""
ENV LOG_GROUP_ID=""
ENV COOKIE_API_BASE=""
ENV COOKIE_API_SECRET=""
ENV DOWNLOAD_DIR="nzb_downloads"
ENV PORT=10000

EXPOSE 10000

CMD ["node", "bot.js"]
