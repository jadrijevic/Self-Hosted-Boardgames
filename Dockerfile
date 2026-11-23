FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY games ./games
COPY public ./public
# Installationen följer med avbilden: compose-filen, installations- och uppdateringsskriptet och kontrollen
COPY deploy ./deploy
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/halsa || exit 1
CMD ["node", "server/index.js"]
