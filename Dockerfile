FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Pre-built by the CI runner (npm run build runs natively before docker build)
COPY --chown=nextjs:nodejs .next/standalone ./
COPY --chown=nextjs:nodejs .next/static    ./.next/static
COPY --chown=nextjs:nodejs public          ./public
COPY --chown=nextjs:nodejs data            ./data

USER nextjs

EXPOSE 3140
ENV PORT=3140
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
