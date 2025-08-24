# Use official Node.js LTS Alpine image for smaller attack surface
FROM node:18-alpine3.18

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Security: Copy package files first for better layer caching
COPY package*.json ./

# Security: Install dependencies with npm ci for production builds
RUN npm ci --only=production && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Security: Copy application code
COPY --chown=nodejs:nodejs . .

# Security: Remove unnecessary files
RUN rm -rf \
    /app/package*.json \
    /app/README.md \
    /app/.git* \
    /app/Dockerfile

# Security: Set file permissions
RUN chmod -R 755 /app

# Security: Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Security: Scan for vulnerabilities (placeholder)
# In real CI/CD, this would be done by external tools
LABEL security.scan="enabled"
LABEL maintainer="devops@bank.com"
LABEL version="1.0.0"

# Security: Use non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# Security: Run with dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Expose port
EXPOSE 3001

# Security: Use exec form to avoid shell injection
CMD ["node", "app.js"]