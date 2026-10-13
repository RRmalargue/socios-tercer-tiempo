FROM node:22-slim

# Instalar herramientas para compilar módulos nativos como better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Limpiar cualquier node_modules previo y compilar limpiamente en Linux
RUN rm -rf node_modules package-lock.json && npm install --production

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]

