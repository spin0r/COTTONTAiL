FROM node:20-slim

WORKDIR /app

# Install root deps
COPY package*.json ./
RUN npm ci

# Install frontend deps
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy source
COPY . .

# Build frontend then compile TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

ENV TELEGRAM_TOKEN=""
ENV TELEGRAPH_TOKEN=""
ENV AUTHORIZED_USERS=""
ENV LOG_GROUP_ID=""
ENV COOKIE_API_BASE=""
ENV COOKIE_API_SECRET=""
ENV DOWNLOAD_DIR="nzb_downloads"
ENV PORT=10000

RUN mkdir -p nzb_downloads temp_zip_uploads

EXPOSE 10000

CMD ["node", "dist/index.js"]
