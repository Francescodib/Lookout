FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
VOLUME /app/data
CMD ["node", "dist/index.js"]
