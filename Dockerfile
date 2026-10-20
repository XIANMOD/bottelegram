FROM node:20-bookworm-slim

WORKDIR /app

# FFmpeg will be used in a later processing stage (vertical crop/subtitles/audio).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["npm", "start"]
