FROM apify/actor-node:24 AS builder

COPY --chown=myuser:myuser package*.json ./
RUN npm ci --include=dev --audit=false

COPY --chown=myuser:myuser . ./
RUN npm run build

FROM apify/actor-node:24

ENV NODE_ENV=production

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional \
    && echo "Node.js version:" \
    && node --version \
    && rm -r ~/.npm

COPY --from=builder --chown=myuser:myuser /usr/src/app/dist ./dist

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.ACTOR_STANDBY_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
