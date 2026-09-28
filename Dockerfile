FROM node:20-bullseye

# git chahiye deploy engine ke liye
RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
