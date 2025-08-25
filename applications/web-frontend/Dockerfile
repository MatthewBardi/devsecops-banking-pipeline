# Build stage
FROM node:18-alpine3.18 as build

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Security: Create non-root user
RUN addgroup -g 1004 -S nginx && \
    adduser -S nginx -u 1004

# Copy build files
COPY --from=build /app/build /usr/share/nginx/html

# Security-hardened nginx config
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf

# Security: Use non-root user
USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
